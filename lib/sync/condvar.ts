import { INTERNAL_MUTEX_CONTROLLER, type MutexGuard } from "./mutex.ts";
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

  #atomic: Int32Array<SharedArrayBuffer>;

  constructor(_buffer?: SharedArrayBuffer) {
    if (_buffer) {
      this.#atomic = new Int32Array(_buffer);
    } else {
      this.#atomic = new Int32Array(new SharedArrayBuffer(4));
    }
  }

  waitSync<T extends SharedMemoryView | void>(guard: MutexGuard<T>): void {
    const controller = guard[INTERNAL_MUTEX_CONTROLLER];
    const seq = Atomics.load(this.#atomic, 0);

    controller.unlock();

    Atomics.wait(this.#atomic, 0, seq);

    controller.lockSync();
  }

  /**
   * Asynchronously waits for a notification. Safe to use on the Main Thread.
   * * @param guard The MutexGuard protecting the shared state.
   */
  async wait<T extends SharedMemoryView | void>(
    guard: MutexGuard<T>,
  ): Promise<void> {
    const controller = guard[INTERNAL_MUTEX_CONTROLLER];
    const seq = Atomics.load(this.#atomic, 0);

    controller.unlock();

    const result = Atomics.waitAsync(this.#atomic, 0, seq);
    if (result.async) {
      await result.value;
    }

    await controller.lock();
  }

  /**
   * Wakes up one blocked thread waiting on this Condvar.
   */
  notifyOne() {
    Atomics.add(this.#atomic, 0, 1);
    Atomics.notify(this.#atomic, 0, 1);
  }

  /**
   * Wakes up all blocked threads waiting on this Condvar.
   */
  notifyAll() {
    Atomics.add(this.#atomic, 0, 1);
    Atomics.notify(this.#atomic, 0, Infinity);
  }

  [toSerialized]() {
    return {
      value: this.#atomic.buffer,
      transfer: [],
    };
  }

  static [toDeserialized](
    obj: ReturnType<Condvar[typeof toSerialized]>["value"],
  ) {
    return new Condvar(obj);
  }
}
