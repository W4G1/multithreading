import type { SharedMemoryView } from "../types.ts";
import {
  deserialize,
  register,
  Serializable,
  serialize,
  toDeserialized,
  toSerialized,
} from "../shared.ts";

export const INTERNAL_RWLOCK_CONTROLLER = Symbol(
  "Thread.InternalRwLockController",
);

// Defines the capabilities hidden from the user but available to the Guard
export interface RwLockController {
  unlock(): void;
}

const UNLOCKED = 0;
const WRITE_LOCKED = -1;
const READ_ONE = 1;

/**
 * Guard for Read access.
 * Allows multiple simultaneous readers.
 */
export class RwLockReadGuard<T extends SharedMemoryView | void>
  implements Disposable {
  #data: T;
  #released = false;
  [INTERNAL_RWLOCK_CONTROLLER]!: RwLockController;

  constructor(data: T, controller: RwLockController) {
    this.#data = data;
    this.#released = false;

    Object.defineProperty(this, INTERNAL_RWLOCK_CONTROLLER, {
      value: controller,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  get value(): T {
    if (this.#released) throw new Error("Cannot access released lock data");
    return this.#data;
  }

  [Symbol.dispose]() {
    if (!this.#released) {
      const controller = this[INTERNAL_RWLOCK_CONTROLLER];
      controller.unlock();
      this.#released = true;
    }
  }

  dispose() {
    return this[Symbol.dispose]();
  }
}

/**
 * Guard for Write access.
 * Ensures exclusive access.
 */
export class RwLockWriteGuard<T extends SharedMemoryView | void>
  implements Disposable {
  #data: T;
  #released = false;
  [INTERNAL_RWLOCK_CONTROLLER]!: RwLockController;

  constructor(data: T, controller: RwLockController) {
    this.#data = data;
    this.#released = false;

    Object.defineProperty(this, INTERNAL_RWLOCK_CONTROLLER, {
      value: controller,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  get value(): T {
    if (this.#released) throw new Error("Cannot access released lock data");
    return this.#data;
  }

  [Symbol.dispose]() {
    if (!this.#released) {
      const controller = this[INTERNAL_RWLOCK_CONTROLLER];
      controller.unlock();
      this.#released = true;
    }
  }

  dispose() {
    return this[Symbol.dispose]();
  }
}

export class RwLock<T extends SharedMemoryView | void = void>
  extends Serializable {
  static {
    register(2, this);
  }

  #lockState: Int32Array<SharedArrayBuffer>;
  #data: T;

  constructor(data?: T, _existingStateBuffer?: SharedArrayBuffer) {
    super();
    this.#data = data as T;
    if (_existingStateBuffer) {
      this.#lockState = new Int32Array(_existingStateBuffer);
    } else {
      this.#lockState = new Int32Array(new SharedArrayBuffer(4));
    }
  }

  /**
   * Unlock logic for readers.
   * Decrements count. If 0, notifies writers.
   */
  #unlockRead(): void {
    const prevState = Atomics.sub(this.#lockState, 0, READ_ONE);
    // If we were the last reader (prevState was 1, now 0), notify potential writers
    if (prevState === READ_ONE) {
      Atomics.notify(this.#lockState, 0, 1);
    }
  }

  /**
   * Unlock logic for writers.
   * Sets state to 0. Notifies all (readers or writers).
   */
  #unlockWrite(): void {
    if (
      Atomics.compareExchange(this.#lockState, 0, WRITE_LOCKED, UNLOCKED) !==
        WRITE_LOCKED
    ) {
      throw new Error(
        "RwLock was not write-locked or locked by another thread",
      );
    }
    // Notify all waiting readers or one waiting writer
    Atomics.notify(this.#lockState, 0, Infinity);
  }

  #createReadController(): RwLockController {
    return {
      unlock: () => this.#unlockRead(),
    };
  }

  #createWriteController(): RwLockController {
    return {
      unlock: () => this.#unlockWrite(),
    };
  }

  public blockingRead(): RwLockReadGuard<T> {
    while (true) {
      const current = Atomics.load(this.#lockState, 0);

      // If write locked (current == -1), wait.
      if (current === WRITE_LOCKED) {
        Atomics.wait(this.#lockState, 0, WRITE_LOCKED);
        continue;
      }

      // Try to increment reader count
      if (
        Atomics.compareExchange(
          this.#lockState,
          0,
          current,
          current + READ_ONE,
        ) === current
      ) {
        return new RwLockReadGuard(this.#data, this.#createReadController());
      }
    }
  }

  public async read(): Promise<RwLockReadGuard<T>> {
    while (true) {
      const current = Atomics.load(this.#lockState, 0);

      if (current === WRITE_LOCKED) {
        const res = Atomics.waitAsync(this.#lockState, 0, WRITE_LOCKED);
        if (res.async) {
          await res.value;
        }
        continue;
      }

      if (
        Atomics.compareExchange(
          this.#lockState,
          0,
          current,
          current + READ_ONE,
        ) === current
      ) {
        return new RwLockReadGuard(this.#data, this.#createReadController());
      }
    }
  }

  public blockingWrite(): RwLockWriteGuard<T> {
    while (true) {
      const current = Atomics.load(this.#lockState, 0);
      // Can only write if strictly UNLOCKED (0).
      if (current !== UNLOCKED) {
        Atomics.wait(this.#lockState, 0, current);
        continue;
      }

      if (
        Atomics.compareExchange(this.#lockState, 0, UNLOCKED, WRITE_LOCKED) ===
          UNLOCKED
      ) {
        return new RwLockWriteGuard(this.#data, this.#createWriteController());
      }
    }
  }

  public async write(): Promise<RwLockWriteGuard<T>> {
    while (true) {
      const current = Atomics.load(this.#lockState, 0);
      if (current !== UNLOCKED) {
        const res = Atomics.waitAsync(this.#lockState, 0, current);
        if (res.async) {
          await res.value;
        }
        continue;
      }

      if (
        Atomics.compareExchange(this.#lockState, 0, UNLOCKED, WRITE_LOCKED) ===
          UNLOCKED
      ) {
        return new RwLockWriteGuard(this.#data, this.#createWriteController());
      }
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
        stateBuffer: this.#lockState.buffer,
        data: serializedData,
      },
      transfer,
    };
  }

  static override [toDeserialized](
    obj: ReturnType<RwLock<any>[typeof toSerialized]>["value"],
  ) {
    let data;
    if (obj.data !== undefined) {
      data = deserialize(obj.data);
    }
    return new RwLock(data, obj.stateBuffer);
  }
}
