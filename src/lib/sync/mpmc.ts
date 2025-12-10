import {
  deserialize,
  register,
  type Serializable,
  serialize,
  toDeserialized,
  toSerialized,
} from "../shared.ts";
import type { Result } from "../types.ts";
import { INTERNAL_SEMAPHORE_CONTROLLER, Semaphore } from "./semaphore.ts";
import { SharedJsonBuffer } from "../json_buffer.ts";

// Memory layout constants
const HEAD_IDX = 0;
const TAIL_IDX = 1;
const CLOSED_IDX = 2;
const CAP_IDX = 3;
// Reference counting indices
const TX_COUNT_IDX = 4;
const RX_COUNT_IDX = 5;
const META_SIZE = 6;

// Internal data container
class ChannelInternals<T> implements Serializable {
  static {
    register(this);
  }

  constructor(
    public state: Int32Array<SharedArrayBuffer>,
    public items: SharedJsonBuffer<(T | null)[]>,
    public sendLock: Semaphore,
    public recvLock: Semaphore,
    public itemsAvailable: Semaphore,
    public slotsAvailable: Semaphore,
  ) {}

  [toSerialized]() {
    const itemsSer = serialize(this.items);
    const sendLockSer = serialize(this.sendLock);
    const recvLockSer = serialize(this.recvLock);
    const itemsAvailSer = serialize(this.itemsAvailable);
    const slotsAvailSer = serialize(this.slotsAvailable);

    return {
      value: {
        state: this.state.buffer,
        items: itemsSer.value,
        sendLock: sendLockSer.value,
        recvLock: recvLockSer.value,
        itemsAvailable: itemsAvailSer.value,
        slotsAvailable: slotsAvailSer.value,
      },
      transfer: [
        ...itemsSer.transfer,
        ...sendLockSer.transfer,
        ...recvLockSer.transfer,
        ...itemsAvailSer.transfer,
        ...slotsAvailSer.transfer,
      ],
    };
  }

  static [toDeserialized](
    data: ReturnType<ChannelInternals<any>[typeof toSerialized]>["value"],
  ) {
    return new ChannelInternals(
      new Int32Array(data.state),
      deserialize(data.items),
      deserialize(data.sendLock),
      deserialize(data.recvLock),
      deserialize(data.itemsAvailable),
      deserialize(data.slotsAvailable),
    );
  }
}

export class Sender<T> implements Serializable, Disposable {
  static {
    register(this);
  }

  private disposed = false;

  constructor(private internals: ChannelInternals<T>) {}

  clone(): Sender<T> {
    if (this.disposed) throw new Error("Cannot clone disposed Sender");
    Atomics.add(this.internals.state, TX_COUNT_IDX, 1);
    return new Sender(this.internals);
  }

  async send(value: T): Promise<Result<void, Error>> {
    if (this.disposed) {
      return { ok: false, error: new Error("Sender is disposed") };
    }
    const { state, items, sendLock, slotsAvailable, itemsAvailable } =
      this.internals;

    if (Atomics.load(state, RX_COUNT_IDX) === 0) {
      return { ok: false, error: new Error("Channel closed (No Receivers)") };
    }

    const slotToken = await slotsAvailable.acquire();

    if (Atomics.load(state, CLOSED_IDX) === 1) {
      slotToken[Symbol.dispose]();
      return { ok: false, error: new Error("Channel closed") };
    }

    try {
      using _lockGuard = await sendLock.acquire();

      if (Atomics.load(state, CLOSED_IDX) === 1) {
        slotToken[Symbol.dispose]();
        return { ok: false, error: new Error("Channel closed") };
      }

      const tail = state[TAIL_IDX]!;
      items[tail] = value;
      state[TAIL_IDX] = (tail + 1) % state[CAP_IDX]!;
    } catch (err) {
      slotToken[Symbol.dispose]();
      throw err;
    }

    itemsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1);
    return { ok: true, value: undefined };
  }

  blockingSend(value: T): Result<void, Error> {
    if (this.disposed) {
      return { ok: false, error: new Error("Sender is disposed") };
    }
    const { state, items, sendLock, slotsAvailable, itemsAvailable } =
      this.internals;

    if (Atomics.load(state, RX_COUNT_IDX) === 0) {
      return { ok: false, error: new Error("Channel closed (No Receivers)") };
    }

    const slotToken = slotsAvailable.blockingAcquire();

    if (Atomics.load(state, CLOSED_IDX) === 1) {
      slotToken[Symbol.dispose]();
      return { ok: false, error: new Error("Channel closed") };
    }

    try {
      const lockToken = sendLock.blockingAcquire();
      try {
        if (Atomics.load(state, CLOSED_IDX) === 1) {
          slotToken[Symbol.dispose]();
          return { ok: false, error: new Error("Channel closed") };
        }

        const tail = state[TAIL_IDX]!;
        items[tail] = value;
        state[TAIL_IDX] = (tail + 1) % state[CAP_IDX]!;
      } finally {
        lockToken[Symbol.dispose]();
      }

      itemsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1);
      return { ok: true, value: undefined };
    } catch (err) {
      slotToken[Symbol.dispose]();
      throw err;
    }
  }

  close() {
    if (this.disposed) return;

    const { state, slotsAvailable, itemsAvailable, sendLock, recvLock } =
      this.internals;

    if (Atomics.load(state, CLOSED_IDX) === 1) return;

    const g1 = sendLock.blockingAcquire();
    const g2 = recvLock.blockingAcquire();

    try {
      if (Atomics.load(state, CLOSED_IDX) === 1) return;
      Atomics.store(state, CLOSED_IDX, 1);
      slotsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1_073_741_823);
      itemsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1_073_741_823);
    } finally {
      g1[Symbol.dispose]();
      g2[Symbol.dispose]();
    }
  }

  [Symbol.dispose]() {
    if (this.disposed) return;

    const prevCount = Atomics.sub(this.internals.state, TX_COUNT_IDX, 1);
    if (prevCount === 1) {
      this.close();
    }
    this.disposed = true;
  }

  [toSerialized]() {
    if (this.disposed) {
      throw new Error("Cannot move a disposed Sender");
    }

    this.disposed = true;

    return serialize(this.internals);
  }

  static [toDeserialized](
    obj: ReturnType<Sender<any>[typeof toSerialized]>["value"],
  ) {
    const internals = deserialize(obj);
    return new Sender(internals);
  }
}

export class Receiver<T> implements Serializable, Disposable {
  static {
    register(this);
  }

  private disposed = false;

  constructor(private internals: ChannelInternals<T>) {}

  clone(): Receiver<T> {
    if (this.disposed) throw new Error("Cannot clone disposed Receiver");
    Atomics.add(this.internals.state, RX_COUNT_IDX, 1);
    return new Receiver(this.internals);
  }

  async recv(): Promise<Result<T, Error>> {
    if (this.disposed) {
      return { ok: false, error: new Error("Receiver disposed") };
    }
    const { state, items, recvLock, itemsAvailable, slotsAvailable } =
      this.internals;

    const itemToken = await itemsAvailable.acquire();
    let val: T;

    try {
      using _lockGuard = await recvLock.acquire();

      const head = state[HEAD_IDX]!;
      val = items[head] as T;

      if (val === null) {
        if (Atomics.load(state, CLOSED_IDX) === 1) {
          itemToken[Symbol.dispose]();
          return { ok: false, error: new Error("Channel closed") };
        }
        itemToken[Symbol.dispose]();
        return {
          ok: false,
          error: new Error("Spurious wakeup or illegal null value"),
        };
      }

      items[head] = null;
      state[HEAD_IDX] = (head + 1) % state[CAP_IDX]!;
    } catch (err) {
      itemToken[Symbol.dispose]();
      throw err;
    }

    slotsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1);
    return { ok: true, value: val };
  }

  blockingRecv(): Result<T, Error> {
    if (this.disposed) {
      return { ok: false, error: new Error("Receiver disposed") };
    }
    const { state, items, recvLock, itemsAvailable, slotsAvailable } =
      this.internals;

    const itemToken = itemsAvailable.blockingAcquire();
    let val: T;

    try {
      const lockToken = recvLock.blockingAcquire();
      try {
        const head = state[HEAD_IDX]!;
        val = items[head] as T;

        if (val === null) {
          if (Atomics.load(state, CLOSED_IDX) === 1) {
            itemToken[Symbol.dispose]();
            return { ok: false, error: new Error("Channel closed") };
          }
          itemToken[Symbol.dispose]();
          return {
            ok: false,
            error: new Error("Spurious wakeup or illegal null value"),
          };
        }

        items[head] = null;
        state[HEAD_IDX] = (head + 1) % state[CAP_IDX]!;
      } finally {
        lockToken[Symbol.dispose]();
      }

      slotsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1);
      return { ok: true, value: val };
    } catch (err) {
      itemToken[Symbol.dispose]();
      throw err;
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, void> {
    while (true) {
      const result = await this.recv();

      if (result.ok) {
        yield result.value;
      } else {
        const msg = result.error.message;

        // Graceful exit conditions:
        // 1. "Channel closed": Sender called close()
        // 2. "Receiver disposed": This handle was disposed explicitly
        if (msg === "Channel closed" || msg === "Receiver disposed") {
          return;
        }

        // Throw on unexpected state corruption (e.g. "Spurious wakeup")
        throw result.error;
      }
    }
  }

  /**
   * Dispose Receiver.
   * Decrements ref count. If 0, we treat the channel as closed.
   */
  [Symbol.dispose]() {
    if (this.disposed) return;
    this.disposed = true;

    const prevCount = Atomics.sub(this.internals.state, RX_COUNT_IDX, 1);
    if (prevCount === 1) {
      // If no receivers are left, we force close the channel so Senders don't block forever.
      const sender = new Sender(this.internals);
      sender.close();
    }
  }

  [toSerialized]() {
    if (this.disposed) {
      throw new Error("Cannot move a disposed Receiver");
    }

    // Kill local handle
    this.disposed = true;

    // Transfer ownership (No increment)
    return serialize(this.internals);
  }

  static [toDeserialized](
    obj: ReturnType<Receiver<any>[typeof toSerialized]>["value"],
  ) {
    const internals = deserialize(obj);
    return new Receiver(internals);
  }
}

export function channel<T>(capacity: number = 32): [Sender<T>, Receiver<T>] {
  const stateSab = new SharedArrayBuffer(META_SIZE * 4);
  const state = new Int32Array(stateSab);
  state[CAP_IDX] = capacity;
  state[HEAD_IDX] = 0;
  state[TAIL_IDX] = 0;
  state[CLOSED_IDX] = 0;

  // Initialize counts
  state[TX_COUNT_IDX] = 1;
  state[RX_COUNT_IDX] = 1;

  const initialData = new Array<T | null>(capacity).fill(null);
  const items = new SharedJsonBuffer(initialData);

  const slotsAvailable = new Semaphore(capacity);
  const itemsAvailable = new Semaphore(0);
  const sendLock = new Semaphore(1);
  const recvLock = new Semaphore(1);

  const internals = new ChannelInternals(
    state,
    items,
    sendLock,
    recvLock,
    itemsAvailable,
    slotsAvailable,
  );

  return [new Sender(internals), new Receiver(internals)];
}
