import {
  deserialize,
  register,
  Serializable,
  serialize,
  toDeserialized,
  toSerialized,
} from "../shared.ts";
import type { Result } from "../types.ts";
import { INTERNAL_SEMAPHORE_CONTROLLER, Semaphore } from "./semaphore.ts";
import { SharedJsonBuffer } from "../json_buffer.ts";

const IDX_HEAD = 0;
const IDX_TAIL = 1;
const IDX_CLOSED = 2;
const IDX_CAP = 3;
const IDX_TX_COUNT = 4;
const IDX_RX_COUNT = 5;

const META_SIZE = 6;

const OPEN = 0;
const CLOSED = 1;

const ERR_DISPOSED_SENDER = new Error("Sender is disposed");
const ERR_DISPOSED_RECEIVER = new Error("Receiver disposed");
const ERR_CLOSED = new Error("Channel closed");
const ERR_CLOSED_NO_RX = new Error("Channel closed (No Receivers)");
const ERR_SPURIOUS = new Error("Spurious wakeup or illegal null value");

class ChannelInternals<T> extends Serializable {
  static {
    register(4, this);
  }

  constructor(
    public state: Int32Array<SharedArrayBuffer>,
    public items: SharedJsonBuffer<(T | null)[]>,
    public sendLock: Semaphore,
    public recvLock: Semaphore,
    public itemsAvailable: Semaphore,
    public slotsAvailable: Semaphore,
  ) {
    super();
  }

  write(value: T): void {
    const tail = this.state[IDX_TAIL]!;
    this.items[tail] = value;
    this.state[IDX_TAIL] = (tail + 1) % this.state[IDX_CAP]!;
  }

  read(): T | null {
    const head = this.state[IDX_HEAD]!;
    const val = this.items[head] as T;

    // Optimistic read check
    if (val === null) return null;

    this.items[head] = null;
    this.state[IDX_HEAD] = (head + 1) % this.state[IDX_CAP]!;
    return val;
  }

  isClosed(): boolean {
    return Atomics.load(this.state, IDX_CLOSED) === CLOSED;
  }

  hasReceivers(): boolean {
    return Atomics.load(this.state, IDX_RX_COUNT) > 0;
  }

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

  static override [toDeserialized](
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

abstract class ChannelHandle<T> extends Serializable implements Disposable {
  protected disposed = false;

  constructor(protected internals: ChannelInternals<T>) {
    super();
  }

  protected abstract get disposeError(): Error;

  protected checkDisposed(): { ok: false; error: Error } | null {
    return this.disposed ? { ok: false, error: this.disposeError } : null;
  }

  [toSerialized]() {
    if (this.disposed) throw new Error("Cannot move a disposed Handle");
    this.disposed = true; // Ownership transfer
    return serialize(this.internals);
  }

  abstract close(): void;
  abstract [Symbol.dispose](): void;
}

export class Sender<T> extends ChannelHandle<T> {
  static {
    register(5, this);
  }

  protected get disposeError() {
    return ERR_DISPOSED_SENDER;
  }

  clone(): Sender<T> {
    if (this.disposed) throw new Error("Cannot clone disposed Sender");
    Atomics.add(this.internals.state, IDX_TX_COUNT, 1);
    return new Sender(this.internals);
  }

  async send(value: T): Promise<Result<void, Error>> {
    const disposedCheck = this.checkDisposed();
    if (disposedCheck) return disposedCheck;

    if (!this.internals.hasReceivers()) {
      return { ok: false, error: ERR_CLOSED_NO_RX };
    }

    const slotToken = await this.internals.slotsAvailable.acquire();

    // Check closed after acquiring slot (race condition check)
    if (this.internals.isClosed()) {
      slotToken[Symbol.dispose]();
      return { ok: false, error: ERR_CLOSED };
    }

    try {
      using _lockGuard = await this.internals.sendLock.acquire();

      if (this.internals.isClosed()) {
        slotToken[Symbol.dispose]();
        return { ok: false, error: ERR_CLOSED };
      }

      this.internals.write(value);
    } catch (err) {
      slotToken[Symbol.dispose]();
      throw err;
    }

    // Handover: Slot token consumed -> Item token released
    this.internals.itemsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1);
    return { ok: true, value: undefined };
  }

  blockingSend(value: T): Result<void, Error> {
    const disposedCheck = this.checkDisposed();
    if (disposedCheck) return disposedCheck;

    if (!this.internals.hasReceivers()) {
      return { ok: false, error: ERR_CLOSED_NO_RX };
    }

    const slotToken = this.internals.slotsAvailable.blockingAcquire();

    if (this.internals.isClosed()) {
      slotToken[Symbol.dispose]();
      return { ok: false, error: ERR_CLOSED };
    }

    try {
      const lockToken = this.internals.sendLock.blockingAcquire();
      try {
        if (this.internals.isClosed()) {
          slotToken[Symbol.dispose]();
          return { ok: false, error: ERR_CLOSED };
        }
        this.internals.write(value);
      } finally {
        lockToken[Symbol.dispose]();
      }

      this.internals.itemsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1);
      return { ok: true, value: undefined };
    } catch (err) {
      slotToken[Symbol.dispose]();
      throw err;
    }
  }

  close() {
    if (this.disposed || this.internals.isClosed()) return;

    const { state, slotsAvailable, itemsAvailable, sendLock, recvLock } =
      this.internals;
    const g1 = sendLock.blockingAcquire();
    const g2 = recvLock.blockingAcquire();

    try {
      if (this.internals.isClosed()) return;
      Atomics.store(state, IDX_CLOSED, CLOSED);
      // Wake up everyone
      slotsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1_073_741_823);
      itemsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1_073_741_823);
    } finally {
      g1[Symbol.dispose]();
      g2[Symbol.dispose]();
    }
  }

  [Symbol.dispose]() {
    if (this.disposed) return;
    const prevCount = Atomics.sub(this.internals.state, IDX_TX_COUNT, 1);
    if (prevCount === 1) this.close();
    this.disposed = true;
  }

  static override [toDeserialized](
    obj: ReturnType<Sender<any>[typeof toSerialized]>["value"],
  ) {
    return new Sender(deserialize(obj));
  }
}

export class Receiver<T> extends ChannelHandle<T> {
  static {
    register(6, this);
  }

  protected get disposeError() {
    return ERR_DISPOSED_RECEIVER;
  }

  clone(): Receiver<T> {
    if (this.disposed) throw new Error("Cannot clone disposed Receiver");
    Atomics.add(this.internals.state, IDX_RX_COUNT, 1);
    return new Receiver(this.internals);
  }

  async recv(): Promise<Result<T, Error>> {
    const disposedCheck = this.checkDisposed();
    if (disposedCheck) return disposedCheck;

    const itemToken = await this.internals.itemsAvailable.acquire();
    let val: T | null;

    try {
      using _lockGuard = await this.internals.recvLock.acquire();
      val = this.internals.read();
    } catch (err) {
      itemToken[Symbol.dispose]();
      throw err;
    }

    // Verify read
    if (val === null) {
      itemToken[Symbol.dispose]();
      return this.internals.isClosed()
        ? { ok: false, error: ERR_CLOSED }
        : { ok: false, error: ERR_SPURIOUS };
    }

    // Handover: Item token consumed -> Slot token released
    this.internals.slotsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1);
    return { ok: true, value: val };
  }

  blockingRecv(): Result<T, Error> {
    const disposedCheck = this.checkDisposed();
    if (disposedCheck) return disposedCheck;

    const itemToken = this.internals.itemsAvailable.blockingAcquire();
    let val: T | null;

    try {
      const lockToken = this.internals.recvLock.blockingAcquire();
      try {
        val = this.internals.read();
      } finally {
        lockToken[Symbol.dispose]();
      }
    } catch (err) {
      itemToken[Symbol.dispose]();
      throw err;
    }

    if (val === null) {
      itemToken[Symbol.dispose]();
      return this.internals.isClosed()
        ? { ok: false, error: ERR_CLOSED }
        : { ok: false, error: ERR_SPURIOUS };
    }

    this.internals.slotsAvailable[INTERNAL_SEMAPHORE_CONTROLLER].release(1);
    return { ok: true, value: val };
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, void> {
    while (true) {
      const result = await this.recv();
      if (result.ok) {
        yield result.value;
      } else {
        const msg = result.error.message;
        if (
          msg === ERR_CLOSED.message ||
          msg === ERR_DISPOSED_RECEIVER.message
        ) {
          return;
        }
        throw result.error;
      }
    }
  }

  close() {
    // Helper to force close via temporary sender
    const sender = new Sender(this.internals);
    sender.close();
  }

  [Symbol.dispose]() {
    if (this.disposed) return;
    this.disposed = true;
    const prevCount = Atomics.sub(this.internals.state, IDX_RX_COUNT, 1);
    if (prevCount === 1) this.close();
  }

  static override [toDeserialized](
    obj: ReturnType<Receiver<any>[typeof toSerialized]>["value"],
  ) {
    return new Receiver(deserialize(obj));
  }
}

export function channel<T>(capacity: number = 32): [Sender<T>, Receiver<T>] {
  const state = new Int32Array(
    new SharedArrayBuffer(META_SIZE * Int32Array.BYTES_PER_ELEMENT),
  );

  state[IDX_CAP] = capacity;
  state[IDX_HEAD] = 0;
  state[IDX_TAIL] = 0;
  state[IDX_CLOSED] = OPEN;
  state[IDX_TX_COUNT] = 1;
  state[IDX_RX_COUNT] = 1;

  const initialData = new Array<T | null>(capacity).fill(null);
  const items = new SharedJsonBuffer(initialData);

  const internals = new ChannelInternals(
    state,
    items,
    new Semaphore(1), // sendLock
    new Semaphore(1), // recvLock
    new Semaphore(0), // itemsAvailable
    new Semaphore(capacity), // slotsAvailable
  );

  return [new Sender(internals), new Receiver(internals)];
}
