import type { SharedJsonBuffer } from "./json_buffer.ts";
import type { PayloadType } from "./shared.ts";

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export interface ThreadTask {
  fnId: string;
  code: string;
  args: unknown[];
}

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
  code: string;
  args: Envelope[];
};

export type WorkerResponsePayload =
  | { type: "RESULT"; taskId: number; result: Envelope }
  | { type: "ERROR"; taskId: number; error: string; stack?: string };
