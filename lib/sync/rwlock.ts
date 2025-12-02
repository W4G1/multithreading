import type { SharedMemoryView } from "../types.ts";
import {
  deserialize,
  register,
  type Serializable,
  serialize,
  toDeserialized,
  toSerialized,
} from "../shared.ts";

const UNLOCKED = 0;
const WRITE_LOCKED = -1;
const READ_ONE = 1;

export interface RwLockReadGuard<T extends SharedMemoryView | void> {
  value: T;
  [Symbol.dispose](): void;
}

export interface RwLockWriteGuard<T extends SharedMemoryView | void> {
  value: T;
  [Symbol.dispose](): void;
}

export class RwLock<T extends SharedMemoryView | void = void>
  implements Serializable {
  static {
    register(this);
  }

  private state: Int32Array<SharedArrayBuffer>;
  private data: T;

  constructor(data?: T, _existingStateBuffer?: SharedArrayBuffer) {
    this.data = data as T;
    if (_existingStateBuffer) {
      this.state = new Int32Array(_existingStateBuffer);
    } else {
      this.state = new Int32Array(new SharedArrayBuffer(4));
    }
  }

  // --- Read Methods ---

  readSync(): RwLockReadGuard<T> {
    while (true) {
      const current = Atomics.load(this.state, 0);
      // If write locked (current == -1), wait.
      if (current === WRITE_LOCKED) {
        Atomics.wait(this.state, 0, WRITE_LOCKED);
        continue;
      }

      // Try to increment reader count
      if (
        Atomics.compareExchange(
          this.state,
          0,
          current,
          current + READ_ONE,
        ) === current
      ) {
        return this.createReadGuard();
      }
      // CAS failed, retry loop
    }
  }

  async read(): Promise<RwLockReadGuard<T>> {
    while (true) {
      const current = Atomics.load(this.state, 0);
      if (current === WRITE_LOCKED) {
        const res = Atomics.waitAsync(this.state, 0, WRITE_LOCKED);
        if (res.async) await res.value;
        continue;
      }

      if (
        Atomics.compareExchange(
          this.state,
          0,
          current,
          current + READ_ONE,
        ) === current
      ) {
        return this.createReadGuard();
      }
    }
  }

  // --- Write Methods ---

  writeSync(): RwLockWriteGuard<T> {
    while (true) {
      const current = Atomics.load(this.state, 0);
      // Can only write if strictly UNLOCKED (0).
      // If readers exist (>0) or another writer (-1), we wait.
      if (current !== UNLOCKED) {
        Atomics.wait(this.state, 0, current);
        continue;
      }

      if (
        Atomics.compareExchange(this.state, 0, UNLOCKED, WRITE_LOCKED) ===
          UNLOCKED
      ) {
        return this.createWriteGuard();
      }
    }
  }

  async write(): Promise<RwLockWriteGuard<T>> {
    while (true) {
      const current = Atomics.load(this.state, 0);
      if (current !== UNLOCKED) {
        const res = Atomics.waitAsync(this.state, 0, current);
        if (res.async) await res.value;
        continue;
      }

      if (
        Atomics.compareExchange(this.state, 0, UNLOCKED, WRITE_LOCKED) ===
          UNLOCKED
      ) {
        return this.createWriteGuard();
      }
    }
  }

  private createReadGuard(): RwLockReadGuard<T> {
    let released = false;
    return {
      value: this.data,
      [Symbol.dispose]: () => {
        if (!released) {
          Atomics.sub(this.state, 0, READ_ONE);
          // If we were the last reader (result is now 0), notify potential writers
          if (Atomics.load(this.state, 0) === UNLOCKED) {
            Atomics.notify(this.state, 0, 1);
          }
          released = true;
        }
      },
    };
  }

  private createWriteGuard(): RwLockWriteGuard<T> {
    let released = false;
    return {
      value: this.data,
      [Symbol.dispose]: () => {
        if (!released) {
          Atomics.store(this.state, 0, UNLOCKED);
          // Notify all waiting readers or one waiting writer
          Atomics.notify(this.state, 0, Infinity);
          released = true;
        }
      },
    };
  }

  [toSerialized]() {
    let serializedData;
    let transfer: Transferable[] = [];

    if (this.data !== undefined) {
      const result = serialize(this.data);
      serializedData = result.value;
      transfer = result.transfer;
    }

    return {
      value: {
        stateBuffer: this.state.buffer,
        data: serializedData,
      },
      transfer,
    };
  }

  static [toDeserialized](
    obj: ReturnType<RwLock<any>[typeof toSerialized]>["value"],
  ) {
    let data;
    if (obj.data !== undefined) {
      data = deserialize(obj.data);
    }
    return new RwLock(data, obj.stateBuffer);
  }
}
