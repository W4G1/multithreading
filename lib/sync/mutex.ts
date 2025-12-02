import type { SharedMemoryView } from "../types.ts";
import {
  deserialize,
  register,
  type Serializable,
  serialize,
  toDeserialized,
  toSerialized,
} from "../shared.ts";

export const UnsafeMutexAccess = Symbol.for("Thread.UnsafeMutexAccess");

const LOCKED = 1;
const UNLOCKED = 0;

export interface MutexGuard<T extends SharedMemoryView | void> {
  value: T;
  // This property is used internally for Condvar to work.
  // But we don't want to expose it to the user
  [UnsafeMutexAccess]: Mutex<T>;
  [Symbol.dispose](): void;
}

// Update generic constraint to allow void, and default to void
export class Mutex<T extends SharedMemoryView | void = void>
  implements Serializable {
  static {
    register(this);
  }

  private lockState: Int32Array<SharedArrayBuffer>;
  private data: T;

  // Make data optional to support void initialization
  constructor(data?: T, _existingLockBuffer?: SharedArrayBuffer) {
    this.data = data as T;

    if (_existingLockBuffer) {
      this.lockState = new Int32Array(_existingLockBuffer);
    } else {
      // 4 bytes for the 32-bit integer lock
      this.lockState = new Int32Array(new SharedArrayBuffer(4));
    }
  }

  /**
   * Non-blocking attempt to acquire lock.
   */
  tryLock(): boolean {
    return (
      Atomics.compareExchange(this.lockState, 0, UNLOCKED, LOCKED) === UNLOCKED
    );
  }

  /**
   * Blocking lock. Throws if called on the Main Thread.
   */
  lockSync(): void {
    while (true) {
      if (
        Atomics.compareExchange(this.lockState, 0, UNLOCKED, LOCKED) ===
          UNLOCKED
      ) {
        return;
      }
      // Blocks here until notified
      Atomics.wait(this.lockState, 0, LOCKED);
    }
  }

  /**
   * Async lock safe for Main Thread.
   */
  async lock(): Promise<void> {
    while (true) {
      if (
        Atomics.compareExchange(this.lockState, 0, UNLOCKED, LOCKED) ===
          UNLOCKED
      ) {
        return;
      }
      // Non-blocking wait
      const result = Atomics.waitAsync(this.lockState, 0, LOCKED);
      if (result.async) {
        await result.value;
      }
    }
  }

  unlock(): void {
    if (
      Atomics.compareExchange(this.lockState, 0, LOCKED, UNLOCKED) !== LOCKED
    ) {
      throw new Error("Mutex was not locked or locked by another thread");
    }
    Atomics.notify(this.lockState, 0, 1);
  }

  acquireSync(): MutexGuard<T> {
    this.lockSync();
    return this.createGuard();
  }

  async acquire(): Promise<MutexGuard<T>> {
    await this.lock();
    return this.createGuard();
  }

  sync<R>(fn: (data: T) => R): R {
    this.lockSync();
    try {
      return fn(this.data);
    } finally {
      this.unlock();
    }
  }

  private createGuard(): MutexGuard<T> {
    let released = false;
    return {
      value: this.data,
      // Pass the current instance so the guard can access .lock()/.unlock()
      [UnsafeMutexAccess]: this,
      [Symbol.dispose]: () => {
        if (!released) {
          this.unlock();
          released = true;
        }
      },
    };
  }

  [toSerialized]() {
    // Serialize the inner data
    // Without this, 'this.data' (SharedJsonBuffer) is passed as a plain object
    // to postMessage, severing the link to the SharedArrayBuffer.

    let serializedData;
    let transfer: Transferable[] = [];

    if (this.data !== undefined) {
      const result = serialize(this.data);
      serializedData = result.value;
      transfer = result.transfer;
    }

    return {
      value: {
        lockBuffer: this.lockState.buffer,
        data: serializedData,
      },
      transfer: transfer,
    };
  }

  static [toDeserialized](
    obj: ReturnType<Mutex<any>[typeof toSerialized]>["value"],
  ) {
    let data;

    if (obj.data !== undefined) {
      data = deserialize(obj.data);
    }

    return new Mutex(data, obj.lockBuffer);
  }
}
