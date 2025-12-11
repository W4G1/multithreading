import {
  register,
  Serializable,
  toDeserialized,
  toSerialized,
} from "../shared.ts";

export const INTERNAL_SEMAPHORE_CONTROLLER = Symbol(
  "Thread.InternalSemaphoreController",
);

export interface SemaphoreController {
  release(amount: number): void;
}

const IDX_PERMITS = 0;
const IDX_WAITERS = 1;

const META_SIZE = 2;

export class SemaphoreGuard implements Disposable {
  readonly #amount: number;
  readonly #controller: SemaphoreController;
  #released = false;

  constructor(amount: number, controller: SemaphoreController) {
    this.#amount = amount;
    this.#controller = controller;
  }

  get [INTERNAL_SEMAPHORE_CONTROLLER](): SemaphoreController {
    return this.#controller;
  }

  get amount(): number {
    return this.#amount;
  }

  [Symbol.dispose](): void {
    if (!this.#released) {
      this.#released = true;
      this.#controller.release(this.#amount);
    }
  }

  dispose(): void {
    this[Symbol.dispose]();
  }
}

export class Semaphore extends Serializable {
  static {
    register(3, this);
  }

  readonly #state: Int32Array<SharedArrayBuffer>;
  readonly #controller: SemaphoreController;

  constructor(initialCount: number, _buffer?: SharedArrayBuffer) {
    super();
    if (_buffer) {
      this.#state = new Int32Array(_buffer);
    } else {
      this.#state = new Int32Array(
        new SharedArrayBuffer(META_SIZE * Int32Array.BYTES_PER_ELEMENT),
      );
      this.#state[IDX_PERMITS] = initialCount;
      this.#state[IDX_WAITERS] = 0;
    }
    this.#controller = {
      release: (amount: number) => this.#release(amount),
    };
  }

  get [INTERNAL_SEMAPHORE_CONTROLLER](): SemaphoreController {
    return this.#controller;
  }

  /**
   * Internal release logic used by the Controller/Guard
   */
  #release(amount: number): void {
    Atomics.add(this.#state, IDX_PERMITS, amount);

    if (Atomics.load(this.#state, IDX_WAITERS) > 0) {
      Atomics.notify(this.#state, IDX_PERMITS, amount);
    }
  }

  public tryAcquire(amount = 1): SemaphoreGuard | null {
    const current = Atomics.load(this.#state, IDX_PERMITS);

    if (current >= amount) {
      const result = Atomics.compareExchange(
        this.#state,
        IDX_PERMITS,
        current,
        current - amount,
      );

      if (result === current) {
        return new SemaphoreGuard(amount, this.#controller);
      }
    }
    return null;
  }

  public blockingAcquire(amount = 1): SemaphoreGuard {
    while (true) {
      const current = Atomics.load(this.#state, IDX_PERMITS);

      if (current >= amount) {
        const result = Atomics.compareExchange(
          this.#state,
          IDX_PERMITS,
          current,
          current - amount,
        );

        if (result === current) {
          return new SemaphoreGuard(amount, this.#controller);
        }
      } else {
        Atomics.add(this.#state, IDX_WAITERS, 1);
        Atomics.wait(this.#state, IDX_PERMITS, current);
        Atomics.sub(this.#state, IDX_WAITERS, 1);
      }
    }
  }

  public async acquire(amount = 1): Promise<SemaphoreGuard> {
    while (true) {
      const current = Atomics.load(this.#state, IDX_PERMITS);

      if (current >= amount) {
        const result = Atomics.compareExchange(
          this.#state,
          IDX_PERMITS,
          current,
          current - amount,
        );

        if (result === current) {
          return new SemaphoreGuard(amount, this.#controller);
        }
      } else {
        Atomics.add(this.#state, IDX_WAITERS, 1);

        const res = Atomics.waitAsync(this.#state, IDX_PERMITS, current);
        if (res.async) {
          await res.value;
        }

        Atomics.sub(this.#state, IDX_WAITERS, 1);
      }
    }
  }

  [toSerialized]() {
    return {
      value: this.#state.buffer,
      transfer: [],
    };
  }

  static override [toDeserialized](buffer: SharedArrayBuffer) {
    return new Semaphore(0, buffer);
  }
}
