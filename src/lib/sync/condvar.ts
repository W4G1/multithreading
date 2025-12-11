import { INTERNAL_MUTEX_CONTROLLER, type MutexGuard } from "./mutex.ts";
import {
  register,
  Serializable,
  toDeserialized,
  toSerialized,
} from "../shared.ts";
import type { SharedMemoryView } from "../types.ts";

const IDX_NOTIFY_SEQ = 0;

const SEQ_INCREMENT = 1;
const NOTIFY_ONE = 1;
const NOTIFY_ALL = Infinity;

export class Condvar extends Serializable {
  static {
    register(1, this);
  }

  #atomic: Int32Array<SharedArrayBuffer>;

  constructor(_buffer?: SharedArrayBuffer) {
    super();
    this.#atomic = new Int32Array(
      _buffer ?? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    );
  }

  blockingWait<T extends SharedMemoryView | void>(guard: MutexGuard<T>): void {
    const controller = guard[INTERNAL_MUTEX_CONTROLLER];
    const seq = Atomics.load(this.#atomic, IDX_NOTIFY_SEQ);

    controller.unlock();

    Atomics.wait(this.#atomic, IDX_NOTIFY_SEQ, seq);

    controller.blockingLock();
  }

  /**
   * Asynchronously waits for a notification. Safe to use on the Main Thread.
   * @param guard The MutexGuard protecting the shared state.
   */
  async wait<T extends SharedMemoryView | void>(
    guard: MutexGuard<T>,
  ): Promise<void> {
    const controller = guard[INTERNAL_MUTEX_CONTROLLER];
    const seq = Atomics.load(this.#atomic, IDX_NOTIFY_SEQ);

    controller.unlock();

    const result = Atomics.waitAsync(this.#atomic, IDX_NOTIFY_SEQ, seq);
    if (result.async) {
      await result.value;
    }

    await controller.lock();
  }

  /**
   * Wakes up one blocked thread waiting on this Condvar.
   */
  notifyOne() {
    Atomics.add(this.#atomic, IDX_NOTIFY_SEQ, SEQ_INCREMENT);
    Atomics.notify(this.#atomic, IDX_NOTIFY_SEQ, NOTIFY_ONE);
  }

  /**
   * Wakes up all blocked threads waiting on this Condvar.
   */
  notifyAll() {
    Atomics.add(this.#atomic, IDX_NOTIFY_SEQ, SEQ_INCREMENT);
    Atomics.notify(this.#atomic, IDX_NOTIFY_SEQ, NOTIFY_ALL);
  }

  [toSerialized]() {
    return {
      value: this.#atomic.buffer,
      transfer: [],
    };
  }

  static override [toDeserialized](
    obj: ReturnType<Condvar[typeof toSerialized]>["value"],
  ) {
    return new Condvar(obj);
  }
}
