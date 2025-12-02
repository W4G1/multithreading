import { type MutexGuard, UnsafeMutexAccess } from "./mutex.ts";
import {
  register,
  type Serializable,
  toDeserialized,
  toSerialized,
} from "../shared.ts";
import type { SharedMemoryView } from "../types.ts";

export class Condvar implements Serializable {
  static {
    register(this);
  }

  private atomic: Int32Array<SharedArrayBuffer>;

  constructor(_buffer?: SharedArrayBuffer) {
    if (_buffer) {
      this.atomic = new Int32Array(_buffer);
    } else {
      // We only need 4 bytes for a simple sequence counter
      this.atomic = new Int32Array(new SharedArrayBuffer(4));
    }
  }

  /**
   * Blocks the current thread until this condition variable is notified.
   *
   * This function consumes the MutexGuard, unlocking the mutex before sleeping,
   * and re-locking it before returning.
   * * @param guard The MutexGuard protecting the shared state.
   */
  waitSync<T extends SharedMemoryView | void>(guard: MutexGuard<T>): void {
    const mutex = guard[UnsafeMutexAccess];

    // 1. Snapshot the current sequence number.
    // We wait strictly on this value changing.
    const seq = Atomics.load(this.atomic, 0);

    // 2. Atomically (conceptually) release the mutex.
    mutex.unlock();

    // 3. Block until notified.
    // If 'seq' has changed between step 1 and 3 (a race), wait() returns immediately.
    Atomics.wait(this.atomic, 0, seq);

    // 4. Re-acquire the mutex before returning control to the caller.
    mutex.lockSync();
  }

  /**
   * Asynchronously waits for a notification. Safe to use on the Main Thread.
   * * @param guard The MutexGuard protecting the shared state.
   */
  async wait<T extends SharedMemoryView | void>(
    guard: MutexGuard<T>,
  ): Promise<void> {
    const mutex = guard[UnsafeMutexAccess];
    const seq = Atomics.load(this.atomic, 0);

    // Unlock
    mutex.unlock();

    // Non-blocking wait
    const result = Atomics.waitAsync(this.atomic, 0, seq);
    if (result.async) {
      await result.value;
    }

    // Re-lock asynchronously
    await mutex.lock();
  }

  /**
   * Wakes up one blocked thread waiting on this Condvar.
   */
  notifyOne() {
    // Increment the sequence number so Atomics.wait detects a change
    Atomics.add(this.atomic, 0, 1);
    Atomics.notify(this.atomic, 0, 1);
  }

  /**
   * Wakes up all blocked threads waiting on this Condvar.
   */
  notifyAll() {
    Atomics.add(this.atomic, 0, 1);
    Atomics.notify(this.atomic, 0, Infinity);
  }

  // --- Serialization ---

  [toSerialized]() {
    return {
      value: this.atomic.buffer,
      transfer: [],
    };
  }

  static [toDeserialized](
    obj: ReturnType<Condvar[typeof toSerialized]>["value"],
  ) {
    return new Condvar(obj);
  }
}
