import { Transferable } from "./transferable.ts";
import { Envelope } from "./types.ts";

export const toSerialized = Symbol("Thread.Serialize");
export const toDeserialized = Symbol("Thread.Deserialize");

export const enum PayloadType {
  RAW = 0, // User data (Numbers, Strings, Plain Objects)
  LIB = 1, // Library data (Mutex, Sender, Receiver)
}

export const enum WorkerTaskType {
  RUN = 0,
}

export const enum WorkerResponseType {
  RESULT = 0,
  ERROR = 1,
}

export interface SerializableConstructor<
  T extends Serializable = Serializable,
> {
  new (...args: any[]): T;
  [toDeserialized](obj: unknown): T;
}

export abstract class Serializable {
  abstract [toSerialized]():
    | readonly [
      /**
       * value
       */
      unknown,
    ]
    | readonly [
      /**
       * value
       */
      unknown,
      /**
       * transfer
       */
      Transferable[],
    ]
    | readonly [
      /**
       * value
       */
      unknown,
      /**
       * transfer
       */
      Transferable[],
      /**
       * typeId (Escape hatch for proxies)
       */
      number,
    ];
  static [toDeserialized](_obj: unknown): Serializable {
    throw new Error(`[toDeserialized] not implemented for ${this.name}`);
  }
}

const classRegistry = new Map<number, SerializableConstructor>();
const reverseClassRegistry = new Map<SerializableConstructor, number>();

export function register(typeId: number, cls: SerializableConstructor) {
  classRegistry.set(typeId, cls);
  reverseClassRegistry.set(cls, typeId);
}

export function serialize(
  arg: any,
): [Envelope, Transferable[]] {
  // Null/Undefined
  if (arg === null || arg === undefined) {
    return [[PayloadType.RAW, arg], []];
  }

  // Library Object (Instance of Serializable)
  if (
    typeof arg === "object" && arg !== null &&
    typeof arg[toSerialized] === "function"
  ) {
    const [value, transfer, typeId] = arg[toSerialized]() as ReturnType<
      Serializable[typeof toSerialized]
    >;
    const Ctor = arg.constructor as SerializableConstructor;

    return [[
      PayloadType.LIB,
      value,
      typeId ?? reverseClassRegistry.get(Ctor)!,
    ], transfer ?? []];
  }

  // Transferables / Raw Data
  const transfer: Transferable[] = [];
  if (arg instanceof SharedArrayBuffer) {
    // No-op
  } else if (ArrayBuffer.isView(arg)) {
    if (!(arg.buffer instanceof SharedArrayBuffer)) {
      transfer.push(arg.buffer);
    }
  } else if (arg instanceof Transferable) {
    transfer.push(arg);
  }

  return [[PayloadType.RAW, arg], transfer] as const;
}

export function deserialize(envelope: Envelope): any {
  if (!envelope || typeof envelope !== "object") return envelope;

  if (envelope[0] === PayloadType.RAW) {
    return envelope[1];
  }

  if (envelope[0] === PayloadType.LIB) {
    const Cls = classRegistry.get(envelope[2]);
    if (Cls) {
      return Cls[toDeserialized](envelope[1]);
    }
    throw new Error(
      `Unknown TypeID ${envelope[2]}. Did you forget to import the class?`,
    );
  }

  return envelope;
}
