import type { SharedMemoryView } from "../types.ts";
import {
  deserialize,
  register,
  type Serializable,
  serialize,
  toDeserialized,
  toSerialized,
} from "../shared.ts";

export const INTERNAL_MUTEX_CONTROLLER = Symbol(
  "Thread.InternalMutexController",
);

// Defines the capabilities usually hidden from the user
export interface MutexController {
  unlock(): void;
  lockSync(): void;
  lock(): Promise<void>;
}
const LOCKED = 1;
const UNLOCKED = 0;

export class MutexGuard<T extends SharedMemoryView | void> {
  #data: T;
  #released = false;
  [INTERNAL_MUTEX_CONTROLLER]!: MutexController;

  /**
   * @internal
   * We pass the controller here, but we don't store it in a public field.
   * We attach it using defineProperty.
   */
  constructor(data: T, controller: MutexController) {
    this.#data = data;
    this.#released = false;

    Object.defineProperty(this, INTERNAL_MUTEX_CONTROLLER, {
      value: controller,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  get value(): T {
    if (this.#released) throw new Error("Cannot access released mutex data");
    return this.#data;
  }

  [Symbol.dispose]() {
    if (!this.#released) {
      const controller = this[INTERNAL_MUTEX_CONTROLLER];
      controller.unlock();
      this.#released = true;
    }
  }
}

export class Mutex<T extends SharedMemoryView | void = void>
  implements Serializable {
  static {
    register(this);
  }

  // Strict private fields
  #lockState: Int32Array<SharedArrayBuffer>;
  #data: T;

  constructor(data?: T, _existingLockBuffer?: SharedArrayBuffer) {
    this.#data = data as T;

    if (_existingLockBuffer) {
      this.#lockState = new Int32Array(_existingLockBuffer);
    } else {
      this.#lockState = new Int32Array(new SharedArrayBuffer(4));
    }
  }

  #tryLock(): boolean {
    return (
      Atomics.compareExchange(this.#lockState, 0, UNLOCKED, LOCKED) === UNLOCKED
    );
  }

  #lockSync(): void {
    while (true) {
      if (this.#tryLock()) return;
      Atomics.wait(this.#lockState, 0, LOCKED);
    }
  }

  async #lock(): Promise<void> {
    while (true) {
      if (this.#tryLock()) return;
      const result = Atomics.waitAsync(this.#lockState, 0, LOCKED);
      if (result.async) {
        await result.value;
      }
    }
  }

  #unlock(): void {
    if (
      Atomics.compareExchange(this.#lockState, 0, LOCKED, UNLOCKED) !== LOCKED
    ) {
      throw new Error("Mutex was not locked or locked by another thread");
    }
    Atomics.notify(this.#lockState, 0, 1);
  }

  /**
   * Creates the closure that allows the Guard to control this Mutex.
   */
  #createController(): MutexController {
    return {
      unlock: () => this.#unlock(),
      lockSync: () => this.#lockSync(),
      lock: () => this.#lock(),
    };
  }

  public acquireSync(): MutexGuard<T> {
    this.#lockSync();
    return new MutexGuard(this.#data, this.#createController());
  }

  public async acquire(): Promise<MutexGuard<T>> {
    await this.#lock();
    return new MutexGuard(this.#data, this.#createController());
  }

  public sync<R>(fn: (data: T) => R): R {
    this.#lockSync();
    try {
      return fn(this.#data);
    } finally {
      this.#unlock();
    }
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
