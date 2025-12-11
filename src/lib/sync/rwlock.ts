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

export interface RwLockController {
  unlock(): void;
}

const INDEX = 0;
const UNLOCKED = 0;
const WRITE_LOCKED = -1;
const READ_ONE = 1;

export class RwLockReadGuard<T extends SharedMemoryView | void>
  implements Disposable {
  #data: T;
  #controller: RwLockController;
  #released = false;

  constructor(data: T, controller: RwLockController) {
    this.#data = data;
    this.#controller = controller;
  }

  get [INTERNAL_RWLOCK_CONTROLLER](): RwLockController {
    return this.#controller;
  }

  get value(): T {
    if (this.#released) throw new Error("Cannot access released lock data");
    return this.#data;
  }

  [Symbol.dispose]() {
    if (!this.#released) {
      this.#released = true;
      this.#controller.unlock();
    }
  }

  dispose() {
    this[Symbol.dispose]();
  }
}

export class RwLockWriteGuard<T extends SharedMemoryView | void>
  implements Disposable {
  #data: T;
  #controller: RwLockController;
  #released = false;

  constructor(data: T, controller: RwLockController) {
    this.#data = data;
    this.#controller = controller;
  }

  get [INTERNAL_RWLOCK_CONTROLLER](): RwLockController {
    return this.#controller;
  }

  get value(): T {
    if (this.#released) throw new Error("Cannot access released lock data");
    return this.#data;
  }

  [Symbol.dispose]() {
    if (!this.#released) {
      this.#released = true;
      this.#controller.unlock();
    }
  }

  dispose() {
    this[Symbol.dispose]();
  }
}

export class RwLock<T extends SharedMemoryView | void = void>
  extends Serializable {
  static {
    register(2, this);
  }

  #data: T;
  #lockState: Int32Array<SharedArrayBuffer>;
  #readController: RwLockController;
  #writeController: RwLockController;

  constructor(data?: T, _existingStateBuffer?: SharedArrayBuffer) {
    super();
    this.#data = data as T;

    this.#lockState = _existingStateBuffer
      ? new Int32Array(_existingStateBuffer)
      : new Int32Array(new SharedArrayBuffer(4));

    this.#readController = { unlock: () => this.#unlockRead() };
    this.#writeController = { unlock: () => this.#unlockWrite() };
  }

  #unlockRead(): void {
    const prevState = Atomics.sub(this.#lockState, INDEX, READ_ONE);
    // If we were the last reader (prevState was 1, now 0), notify writers
    if (prevState === READ_ONE) {
      Atomics.notify(this.#lockState, INDEX, 1);
    }
  }

  #unlockWrite(): void {
    if (
      Atomics.compareExchange(
        this.#lockState,
        INDEX,
        WRITE_LOCKED,
        UNLOCKED,
      ) !==
        WRITE_LOCKED
    ) {
      throw new Error(
        "RwLock was not write-locked or locked by another thread",
      );
    }
    // Notify all waiting readers or one waiting writer.
    // We use Infinity because we might have N readers waiting.
    Atomics.notify(this.#lockState, INDEX, Infinity);
  }

  // --- Public API ---

  public blockingRead(): RwLockReadGuard<T> {
    while (true) {
      const current = Atomics.load(this.#lockState, INDEX);

      // If write locked (current == -1), wait.
      if (current === WRITE_LOCKED) {
        Atomics.wait(this.#lockState, INDEX, WRITE_LOCKED);
        continue;
      }

      // Optimistic increment
      if (
        Atomics.compareExchange(
          this.#lockState,
          INDEX,
          current,
          current + READ_ONE,
        ) === current
      ) {
        return new RwLockReadGuard(this.#data, this.#readController);
      }
    }
  }

  public async read(): Promise<RwLockReadGuard<T>> {
    while (true) {
      const current = Atomics.load(this.#lockState, INDEX);

      if (current === WRITE_LOCKED) {
        const res = Atomics.waitAsync(this.#lockState, INDEX, WRITE_LOCKED);
        if (res.async) {
          await res.value;
        }
        continue;
      }

      if (
        Atomics.compareExchange(
          this.#lockState,
          INDEX,
          current,
          current + READ_ONE,
        ) === current
      ) {
        return new RwLockReadGuard(this.#data, this.#readController);
      }
    }
  }

  public blockingWrite(): RwLockWriteGuard<T> {
    while (true) {
      const current = Atomics.load(this.#lockState, INDEX);
      // Can only write if strictly UNLOCKED (0).
      if (current !== UNLOCKED) {
        Atomics.wait(this.#lockState, INDEX, current);
        continue;
      }

      if (
        Atomics.compareExchange(
          this.#lockState,
          INDEX,
          UNLOCKED,
          WRITE_LOCKED,
        ) ===
          UNLOCKED
      ) {
        return new RwLockWriteGuard(this.#data, this.#writeController);
      }
    }
  }

  public async write(): Promise<RwLockWriteGuard<T>> {
    while (true) {
      const current = Atomics.load(this.#lockState, INDEX);
      if (current !== UNLOCKED) {
        const res = Atomics.waitAsync(this.#lockState, INDEX, current);
        if (res.async) {
          await res.value;
        }
        continue;
      }

      if (
        Atomics.compareExchange(
          this.#lockState,
          INDEX,
          UNLOCKED,
          WRITE_LOCKED,
        ) ===
          UNLOCKED
      ) {
        return new RwLockWriteGuard(this.#data, this.#writeController);
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
    const data = obj.data !== undefined ? deserialize(obj.data) : undefined;
    return new RwLock(data, obj.stateBuffer);
  }
}
