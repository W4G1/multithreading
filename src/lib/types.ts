import type { SharedJsonBuffer } from "./json_buffer.ts";
import type { PayloadType } from "./shared.ts";

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface JoinHandle<T> {
  join(): Promise<Result<T, Error>>;
  abort(): void;
}

export type SharedMemoryView =
  | Int8Array<SharedArrayBuffer>
  | Uint8Array<SharedArrayBuffer>
  | Uint8ClampedArray<SharedArrayBuffer>
  | Int16Array<SharedArrayBuffer>
  | Uint16Array<SharedArrayBuffer>
  | Int32Array<SharedArrayBuffer>
  | Uint32Array<SharedArrayBuffer>
  | Float32Array<SharedArrayBuffer>
  | Float64Array<SharedArrayBuffer>
  | BigInt64Array<SharedArrayBuffer>
  | BigUint64Array<SharedArrayBuffer>
  | DataView<SharedArrayBuffer>
  | SharedJsonBuffer<any>;

/**
 * The internal task structure passed from lib -> pool
 */
export interface ThreadTask {
  fnId: string;
  code: string; // The code is always available here, but Pool decides if it sends it
  args: unknown[];
}

/**
 * The wire format.
 * 't': type
 * 'v': value
 * 'c': typeId (optional, only for LIB)
 */
export type Envelope =
  | { t: PayloadType.RAW; v: any }
  | { t: PayloadType.LIB; c: number; v: any };

export type WorkerTaskPayload = {
  type: "RUN";
  taskId: number;
  fnId: string;
  code?: string; // Optional: Only sent if worker doesn't have it
  args: Envelope[];
};

export type WorkerResponsePayload =
  | { type: "RESULT"; taskId: number; result: Envelope }
  | { type: "ERROR"; taskId: number; error: string; stack?: string };

export type UserFunction = (
  ...args: unknown[]
) => Promise<unknown> | unknown;
