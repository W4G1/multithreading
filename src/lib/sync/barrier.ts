import {
  register,
  Serializable,
  toDeserialized,
  toSerialized,
} from "../shared.ts";

const IDX_LOCK = 0;
const IDX_CAP = 1; // Capacity (N)
const IDX_COUNT = 2; // Current count (Starts at 0, goes to N, or N down to 0)
const IDX_GEN = 3; // Generation ID

const META_SIZE = 4;

const LOCK_UNLOCKED = 0;
const LOCK_LOCKED = 1;

export interface BarrierWaitResult {
  isLeader: boolean;
}

export class Barrier extends Serializable {
  static {
    register(8, this);
  }

  readonly #state: Int32Array<SharedArrayBuffer>;

  constructor(n?: number, _buffer?: SharedArrayBuffer) {
    super();
    if (_buffer) {
      this.#state = new Int32Array(_buffer);
    } else {
      if (n === undefined) {
        throw new Error("Barrier capacity must be provided");
      }
      this.#state = new Int32Array(
        new SharedArrayBuffer(META_SIZE * Int32Array.BYTES_PER_ELEMENT),
      );
      this.#state[IDX_LOCK] = LOCK_UNLOCKED;
      this.#state[IDX_CAP] = n;
      this.#state[IDX_COUNT] = n; // We count down from N to 0
      this.#state[IDX_GEN] = 0;
    }
  }

  /**
   * Internal Spin/Wait Lock for protecting state updates.
   * Updates are very fast, so we use a simple atomic lock mechanism.
   */
  #lock() {
    while (
      Atomics.compareExchange(
        this.#state,
        IDX_LOCK,
        LOCK_UNLOCKED,
        LOCK_LOCKED,
      ) !== LOCK_UNLOCKED
    ) {
      Atomics.wait(this.#state, IDX_LOCK, LOCK_LOCKED);
    }
  }

  #unlock() {
    if (
      Atomics.compareExchange(
        this.#state,
        IDX_LOCK,
        LOCK_LOCKED,
        LOCK_UNLOCKED,
      ) !== LOCK_LOCKED
    ) {
      throw new Error("Barrier lock state corrupted");
    }
    Atomics.notify(this.#state, IDX_LOCK, 1);
  }

  /**
   * Async version of the internal lock for Main Thread compatibility.
   */
  async #lockAsync() {
    while (
      Atomics.compareExchange(
        this.#state,
        IDX_LOCK,
        LOCK_UNLOCKED,
        LOCK_LOCKED,
      ) !== LOCK_UNLOCKED
    ) {
      const res = Atomics.waitAsync(this.#state, IDX_LOCK, LOCK_LOCKED);
      if (res.async) {
        await res.value;
      }
    }
  }

  /**
   * Blocks the current thread until all participating threads have reached the barrier.
   */
  blockingWait(): BarrierWaitResult {
    this.#lock();
    const localGen = Atomics.load(this.#state, IDX_GEN);
    const count = Atomics.load(this.#state, IDX_COUNT) - 1;

    if (count === 0) {
      // We are the leader (the last one to arrive)
      Atomics.store(this.#state, IDX_COUNT, Atomics.load(this.#state, IDX_CAP));
      Atomics.add(this.#state, IDX_GEN, 1);
      this.#unlock();

      // Wake everyone up. They are waiting on IDX_GEN changing.
      Atomics.notify(this.#state, IDX_GEN, Infinity);
      return { isLeader: true };
    } else {
      // We are a follower
      Atomics.store(this.#state, IDX_COUNT, count);
      this.#unlock();

      // Wait until the generation changes
      while (Atomics.load(this.#state, IDX_GEN) === localGen) {
        Atomics.wait(this.#state, IDX_GEN, localGen);
      }
      return { isLeader: false };
    }
  }

  /**
   * Asynchronously waits until all participating threads have reached the barrier.
   */
  async wait(): Promise<BarrierWaitResult> {
    await this.#lockAsync();
    const localGen = Atomics.load(this.#state, IDX_GEN);
    const count = Atomics.load(this.#state, IDX_COUNT) - 1;

    if (count === 0) {
      // We are the leader
      Atomics.store(this.#state, IDX_COUNT, Atomics.load(this.#state, IDX_CAP));
      Atomics.add(this.#state, IDX_GEN, 1);
      this.#unlock();

      Atomics.notify(this.#state, IDX_GEN, Infinity);
      return { isLeader: true };
    } else {
      // We are a follower
      Atomics.store(this.#state, IDX_COUNT, count);
      this.#unlock();

      // Wait until the generation changes
      while (Atomics.load(this.#state, IDX_GEN) === localGen) {
        const res = Atomics.waitAsync(this.#state, IDX_GEN, localGen);
        if (res.async) {
          await res.value;
        }
      }
      return { isLeader: false };
    }
  }

  [toSerialized]() {
    return {
      value: this.#state.buffer,
      transfer: [],
    };
  }

  static override [toDeserialized](
    buffer: ReturnType<Barrier[typeof toSerialized]>["value"],
  ) {
    return new Barrier(undefined, buffer);
  }
}
