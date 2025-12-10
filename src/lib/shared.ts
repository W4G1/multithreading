export const toSerialized = Symbol.for("Thread.Serialize");
export const toDeserialized = Symbol.for("Thread.Deserialize");

// --- 1. The Envelope Protocol (Strict Isolation) ---

export const enum PayloadType {
  RAW = 0, // User data (Numbers, Strings, Plain Objects)
  LIB = 1, // Library data (Mutex, Sender, Receiver)
}

/**
 * The strict wire format.
 * 't': type
 * 'v': value
 * 'c': class name (optional, only for LIB)
 */
export type Envelope =
  | { t: PayloadType.RAW; v: any }
  | { t: PayloadType.LIB; c: string; v: any };

// --- 2. Interface Definitions ---

export interface SerializedResult {
  value: Envelope; // We strictly return an Envelope
  transfer: Transferable[];
}

export interface Serializable {
  [toSerialized](): {
    value: any;
    transfer: Transferable[];
    className?: string; // Added optional className override for Proxies
  };
}

export interface DeserializableConstructor {
  new (...args: any[]): any;
  name: string;
  [toDeserialized](data: any): any;
}

const classRegistry = new Map<string, DeserializableConstructor>();

export function register(cls: DeserializableConstructor) {
  classRegistry.set(cls.name, cls);
}

// --- 3. Strict Serializer ---

const TRANSFERABLE_CLASSES = [
  MessagePort,
  ReadableStream,
  WritableStream,
  TransformStream,
  // ImageBitmap,
  ArrayBuffer,
];

export function serialize(arg: any): SerializedResult {
  // A. Null/Undefined -> Raw Envelope
  if (arg === null || arg === undefined) {
    return { value: { t: PayloadType.RAW, v: arg }, transfer: [] };
  }

  // B. Library Object (Mutex, Sender) -> Lib Envelope
  if (typeof arg === "object" && typeof arg[toSerialized] === "function") {
    const { value, transfer, className } = (arg as Serializable)[
      toSerialized
    ]();
    // Use the explicit className if provided (essential for Proxies), otherwise constructor.name
    const c = className ?? arg.constructor.name;
    return {
      value: { t: PayloadType.LIB, c, v: value },
      transfer,
    };
  }

  // C. Transferables (SAB, ArrayBuffer, MessagePort) -> Raw Envelope
  // We still need to extract the transferables for postMessage
  const transfer: Transferable[] = [];

  if (arg instanceof SharedArrayBuffer) {
    // SAB is raw data, not transferred
  } else if (ArrayBuffer.isView(arg)) {
    if (!(arg.buffer instanceof SharedArrayBuffer)) {
      transfer.push(arg.buffer);
    }
  } else if (TRANSFERABLE_CLASSES.some((t) => arg instanceof t)) {
    transfer.push(arg as Transferable);
  }

  // D. Everything else (User Objects/Arrays) -> Raw Envelope
  // We wrap it blindly. If the user passes { t: 1, c: "Mutex" }, it just becomes
  // the 'v' inside a RAW envelope. No collision possible.
  return {
    value: { t: PayloadType.RAW, v: arg },
    transfer,
  };
}

// --- 4. Strict Deserializer ---

export function deserialize(envelope: Envelope): any {
  // We only accept Envelopes.
  if (!envelope || typeof envelope !== "object") {
    // Should theoretically not happen if protocol is followed,
    // but useful for debugging.
    return envelope;
  }

  // Case 1: Raw User Data
  if (envelope.t === PayloadType.RAW) {
    return envelope.v;
  }

  // Case 2: Library Object
  if (envelope.t === PayloadType.LIB) {
    const Cls = classRegistry.get(envelope.c);
    if (Cls && typeof Cls[toDeserialized] === "function") {
      return Cls[toDeserialized](envelope.v);
    }

    throw new Error(
      "Unable to deserialize internal library object: " + envelope.c,
    );

    // Fallback: If we can't hydrate, return the raw internal state
    // so data isn't lost.
    // return envelope.v;
  }

  return envelope;
}

export type WorkerTaskPayload = {
  type: "RUN";
  taskId: number;
  fnId: string;
  code: string;
  args: Envelope[];
};

export type WorkerResponsePayload =
  | { type: "RESULT"; taskId: number; result: Envelope }
  | { type: "ERROR"; taskId: number; error: string; stack?: string };
