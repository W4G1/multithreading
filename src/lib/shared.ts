import { Envelope } from "./types.ts";

export const toSerialized = Symbol.for("Thread.Serialize");
export const toDeserialized = Symbol.for("Thread.Deserialize");

export const enum PayloadType {
  RAW = 0, // User data (Numbers, Strings, Plain Objects)
  LIB = 1, // Library data (Mutex, Sender, Receiver)
}

export interface SerializableConstructor<
  T extends Serializable = Serializable,
> {
  new (...args: any[]): T;
  [toDeserialized](obj: unknown): T;
}

export abstract class Serializable {
  abstract [toSerialized](): {
    value: unknown;
    transfer: Transferable[];
    // Escape hatch for proxies
    typeId?: number;
  };
  static [toDeserialized](obj: unknown): Serializable {
    throw new Error(`[toDeserialized] not implemented for ${this.name}`);
  }
}

const classRegistry = new Map<number, SerializableConstructor>();
const reverseClassRegistry = new Map<SerializableConstructor, number>();

export function register(typeId: number, cls: SerializableConstructor) {
  classRegistry.set(typeId, cls);
  reverseClassRegistry.set(cls, typeId);
}

const TRANSFERABLE_CLASSES = [
  MessagePort,
  ReadableStream,
  WritableStream,
  TransformStream,
  ArrayBuffer,
];

export function serialize(arg: any): {
  value: Envelope;
  transfer: Transferable[];
} {
  // Null/Undefined
  if (arg === null || arg === undefined) {
    return { value: { t: PayloadType.RAW, v: arg }, transfer: [] };
  }

  // Library Object (Instance of Serializable)
  if (typeof arg === "object" && typeof arg[toSerialized] === "function") {
    const { value, transfer, typeId } = arg[toSerialized]();
    const Ctor = arg.constructor as SerializableConstructor;

    return {
      value: {
        t: PayloadType.LIB,
        c: typeId ?? reverseClassRegistry.get(Ctor)!,
        v: value,
      },
      transfer,
    };
  }

  // Transferables / Raw Data
  const transfer: Transferable[] = [];
  if (arg instanceof SharedArrayBuffer) {
    // No-op
  } else if (ArrayBuffer.isView(arg)) {
    if (!(arg.buffer instanceof SharedArrayBuffer)) {
      transfer.push(arg.buffer);
    }
  } else if (TRANSFERABLE_CLASSES.some((t) => arg instanceof t)) {
    transfer.push(arg as Transferable);
  }

  return {
    value: { t: PayloadType.RAW, v: arg },
    transfer,
  };
}

export function deserialize(envelope: Envelope): any {
  if (!envelope || typeof envelope !== "object") return envelope;

  if (envelope.t === PayloadType.RAW) {
    return envelope.v;
  }

  if (envelope.t === PayloadType.LIB) {
    const Cls = classRegistry.get(envelope.c);
    if (Cls) {
      return Cls[toDeserialized](envelope.v);
    }
    throw new Error(
      `Unknown TypeID ${envelope.c}. Did you forget to import the class?`,
    );
  }

  return envelope;
}
