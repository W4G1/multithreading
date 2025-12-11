import type { SharedMemoryView } from "../types.ts";
import {
  deserialize,
  register,
  Serializable,
  serialize,
  toDeserialized,
  toSerialized,
} from "../shared.ts";

export const INTERNAL_MUTEX_CONTROLLER = Symbol(
  "Thread.InternalMutexController",
);

const INDEX = 0;
const LOCKED = 1;
const UNLOCKED = 0;

export interface MutexController {
  unlock(): void;
  blockingLock(): void;
  lock(): Promise<void>;
}

export class MutexGuard<T extends SharedMemoryView | void>
  implements Disposable {
  #data: T;
  #mutex: MutexController;
  #released = false;

  constructor(data: T, mutex: MutexController) {
    this.#data = data;
    this.#mutex = mutex;
  }

  /**
   * Internal accessor for Condvar support
   */
  get [INTERNAL_MUTEX_CONTROLLER](): MutexController {
    return this.#mutex;
  }

  get value(): T {
    if (this.#released) throw new Error("Cannot access released mutex data");
    return this.#data;
  }

  [Symbol.dispose]() {
    if (!this.#released) {
      this.#released = true;
      this.#mutex.unlock();
    }
  }

  dispose() {
    this[Symbol.dispose]();
  }
}

export class Mutex<T extends SharedMemoryView | void = void>
  extends Serializable {
  static {
    register(0, this);
  }

  #data: T;
  #lockState: Int32Array<SharedArrayBuffer>;
  #controller: MutexController;

  constructor(data?: T, _existingLockBuffer?: SharedArrayBuffer) {
    super();
    this.#data = data as T;
    this.#lockState = _existingLockBuffer
      ? new Int32Array(_existingLockBuffer)
      : new Int32Array(new SharedArrayBuffer(4));
    this.#controller = {
      unlock: () => this.#unlock(),
      blockingLock: () => this.#performBlockingLock(),
      lock: () => this.#performAsyncLock(),
    };
  }

  #tryLock(): boolean {
    return (
      Atomics.compareExchange(this.#lockState, INDEX, UNLOCKED, LOCKED) ===
        UNLOCKED
    );
  }

  #unlock(): void {
    if (
      Atomics.compareExchange(this.#lockState, INDEX, LOCKED, UNLOCKED) !==
        LOCKED
    ) {
      throw new Error("Mutex was not locked or locked by another thread");
    }
    Atomics.notify(this.#lockState, INDEX, 1);
  }

  /**
   * Shared logic for blocking lock.
   * Used by both public blockingLock() and the Controller (for Condvar)
   */
  #performBlockingLock(): void {
    while (true) {
      if (this.#tryLock()) return;
      Atomics.wait(this.#lockState, INDEX, LOCKED);
    }
  }

  /**
   * Shared logic for async lock.
   * Used by both public lock() and the Controller (for Condvar)
   */
  async #performAsyncLock(): Promise<void> {
    while (true) {
      if (this.#tryLock()) return;
      const result = Atomics.waitAsync(this.#lockState, INDEX, LOCKED);
      if (result.async) {
        await result.value;
      }
    }
  }

  public blockingLock(): MutexGuard<T> {
    this.#performBlockingLock();
    return new MutexGuard(this.#data, this.#controller);
  }

  public async lock(): Promise<MutexGuard<T>> {
    await this.#performAsyncLock();
    return new MutexGuard(this.#data, this.#controller);
  }

  [toSerialized]() {
    let serializedData;
    let transfer: Transferable[] = [];

    if (this.#data !== undefined) {
      const result = serialize(this.#data);
      serializedData = result.value;
      transfer = result.transfer;
    }

    return {
      value: {
        lockBuffer: this.#lockState.buffer,
        data: serializedData,
      },
      transfer: transfer,
    };
  }

  static override [toDeserialized](
    obj: ReturnType<Mutex<any>[typeof toSerialized]>["value"],
  ) {
    const data = obj.data !== undefined ? deserialize(obj.data) : undefined;
    return new Mutex(data, obj.lockBuffer);
  }
}
