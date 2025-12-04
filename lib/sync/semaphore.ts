import {
  register,
  type Serializable,
  toDeserialized,
  toSerialized,
} from "../shared.ts";

export interface SemaphoreGuard {
  [Symbol.dispose](): void;
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
  public state: Int32Array<SharedArrayBuffer>;

  constructor(initialCount: number, _buffer?: SharedArrayBuffer) {
    if (_buffer) {
      this.state = new Int32Array(_buffer);
    } else {
      this.state = new Int32Array(new SharedArrayBuffer(8));
      this.state[0] = initialCount;
      this.state[1] = 0;
    }
  }

  /**
   * Tries to acquire `amount` permits immediately.
   * Returns a Guard if successful, null if not.
   */
  tryAcquire(amount = 1): SemaphoreGuard | null {
    const current = Atomics.load(this.state, 0);
    if (current >= amount) {
      if (
        Atomics.compareExchange(this.state, 0, current, current - amount) ===
          current
      ) {
        return this.createGuard(amount);
      }
    }
    return null;
  }

  /**
   * Blocks until permits are available, then returns a Disposable Guard.
   * When the Guard goes out of scope, the permits are released.
   */
  acquireSync(amount = 1): SemaphoreGuard {
    while (true) {
      const current = Atomics.load(this.state, 0);

      if (current >= amount) {
        if (
          Atomics.compareExchange(this.state, 0, current, current - amount) ===
            current
        ) {
          return this.createGuard(amount);
        }
      } else {
        Atomics.add(this.state, 1, 1);
        Atomics.wait(this.state, 0, current);
        Atomics.sub(this.state, 1, 1);
      }
    }
  }

  /**
   * Asynchronously waits for permits, returning a Disposable Guard.
   */
  async acquire(amount = 1): Promise<SemaphoreGuard> {
    while (true) {
      const current = Atomics.load(this.state, 0);

      if (current >= amount) {
        if (
          Atomics.compareExchange(this.state, 0, current, current - amount) ===
            current
        ) {
          return this.createGuard(amount);
        }
      } else {
        Atomics.add(this.state, 1, 1);
        const res = Atomics.waitAsync(this.state, 0, current);
        if (res.async) {
          await res.value;
        }
        Atomics.sub(this.state, 1, 1);
      }
    }
  }

  /**
   * Manually releases permits.
   * Note: If you used acquire(), the Guard will call this automatically.
   * Only call this manually if you are NOT using the `using` keyword or the guard.
   */
  release(amount = 1): void {
    Atomics.add(this.state, 0, amount);
    const waiters = Atomics.load(this.state, 1);
    if (waiters > 0) {
      Atomics.notify(this.state, 0, amount);
    }
  }

  /**
   * Internal helper to create the Disposable object.
   * It captures the 'amount' so the user doesn't have to remember it when disposing.
   */
  private createGuard(amount: number): SemaphoreGuard {
    let released = false;
    return {
      [Symbol.dispose]: () => {
        if (!released) {
          this.release(amount);
          released = true;
        }
      },
    };
  }

  // --- Serialization ---

  [toSerialized]() {
    return {
      value: this.state.buffer,
      transfer: [],
    };
  }

  static [toDeserialized](buffer: SharedArrayBuffer) {
    return new Semaphore(0, buffer);
  }
}
