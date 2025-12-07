import {
  register,
  type Serializable,
  toDeserialized,
  toSerialized,
} from "../shared.ts";

export const INTERNAL_SEMAPHORE_CONTROLLER = Symbol(
  "Thread.InternalSemaphoreController",
);

// Defines the capabilities hidden from the user but available to the Guard
export interface SemaphoreController {
  release(amount: number): void;
}

export class SemaphoreGuard {
  #amount: number;
  #released = false;
  [INTERNAL_SEMAPHORE_CONTROLLER]!: SemaphoreController;

  constructor(amount: number, controller: SemaphoreController) {
    this.#amount = amount;
    this.#released = false;

    Object.defineProperty(this, INTERNAL_SEMAPHORE_CONTROLLER, {
      value: controller,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  /**
   * Returns the number of permits held by this guard.
   */
  get amount(): number {
    return this.#amount;
  }

  [Symbol.dispose]() {
    if (!this.#released) {
      const controller = this[INTERNAL_SEMAPHORE_CONTROLLER];
      controller.release(this.#amount);
      this.#released = true;
    }
  }

  /**
   * Releases the permits held by this guard.
   */
  dispose() {
    return this[Symbol.dispose]();
  }
}

export class Semaphore implements Serializable {
  static {
    register(this);
  }

  /**
   * Int32Array structure:
   * [0]: value (The current number of permits available)
   * [1]: waiters (The number of threads currently waiting)
   */
  #state: Int32Array<SharedArrayBuffer>;
  [INTERNAL_SEMAPHORE_CONTROLLER]!: SemaphoreController;

  constructor(initialCount: number, _buffer?: SharedArrayBuffer) {
    if (_buffer) {
      this.#state = new Int32Array(_buffer);
    } else {
      this.#state = new Int32Array(new SharedArrayBuffer(8));
      this.#state[0] = initialCount;
      this.#state[1] = 0;
    }

    Object.defineProperty(this, INTERNAL_SEMAPHORE_CONTROLLER, {
      value: this.#createController(),
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  #release(amount: number): void {
    // 1. Return permits to the pool
    Atomics.add(this.#state, 0, amount);

    // 2. Check if there are waiters
    const waiters = Atomics.load(this.#state, 1);

    // 3. If there are waiters, wake them up.
    // We notify 'amount' waiters, as we just added 'amount' permits.
    if (waiters > 0) {
      Atomics.notify(this.#state, 0, amount);
    }
  }

  #createController(): SemaphoreController {
    return {
      release: (amount) => this.#release(amount),
    };
  }

  /**
   * Tries to acquire `amount` permits immediately.
   * Returns a Guard if successful, null if not.
   */
  public tryAcquire(amount = 1): SemaphoreGuard | null {
    const current = Atomics.load(this.#state, 0);
    if (current >= amount) {
      if (
        Atomics.compareExchange(this.#state, 0, current, current - amount) ===
          current
      ) {
        return new SemaphoreGuard(amount, this.#createController());
      }
    }
    return null;
  }

  /**
   * Blocks until permits are available, then returns a Disposable Guard.
   * When the Guard goes out of scope, the permits are released.
   */
  public blockingAcquire(amount = 1): SemaphoreGuard {
    while (true) {
      const current = Atomics.load(this.#state, 0);

      // Try to acquire
      if (current >= amount) {
        if (
          Atomics.compareExchange(this.#state, 0, current, current - amount) ===
            current
        ) {
          return new SemaphoreGuard(amount, this.#createController());
        }
      } else {
        // Wait logic
        // Increment waiter count
        Atomics.add(this.#state, 1, 1);
        // Wait on index 0 (value) to change
        Atomics.wait(this.#state, 0, current);
        // Decrement waiter count
        Atomics.sub(this.#state, 1, 1);
      }
    }
  }

  /**
   * Asynchronously waits for permits, returning a Disposable Guard.
   */
  public async acquire(amount = 1): Promise<SemaphoreGuard> {
    while (true) {
      const current = Atomics.load(this.#state, 0);

      if (current >= amount) {
        if (
          Atomics.compareExchange(this.#state, 0, current, current - amount) ===
            current
        ) {
          return new SemaphoreGuard(amount, this.#createController());
        }
      } else {
        Atomics.add(this.#state, 1, 1);
        const res = Atomics.waitAsync(this.#state, 0, current);
        if (res.async) {
          await res.value;
        }
        Atomics.sub(this.#state, 1, 1);
      }
    }
  }

  [toSerialized]() {
    return {
      value: this.#state.buffer,
      transfer: [],
    };
  }

  static [toDeserialized](buffer: SharedArrayBuffer) {
    return new Semaphore(0, buffer);
  }
}
