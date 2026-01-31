import type { SharedJsonBuffer } from "./json_buffer.ts";
import type {
  PayloadType,
  WorkerResponseType,
  WorkerTaskType,
} from "./shared.ts";

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
export type ThreadTask = [
  /**
   * fnId
   */
  number,
  /**
   * code (Is always available here, but Pool decides if it sends it)
   */
  string,
  /**
   * args
   */
  unknown[],
];

/**
 * The wire format.
 * [type, value, typeId (optional, only for LIB)]
 */
export type Envelope =
  | readonly [PayloadType.RAW, any]
  | readonly [PayloadType.LIB, any, number];

export type WorkerTaskPayload = [
  /**
   * type
   */
  WorkerTaskType.RUN,
  /**
   * taskId
   */
  number,
  /**
   * fnId
   */
  number,
  /**
   * args
   */
  Envelope[],
  /**
   * code
   */
  string | undefined,
];

export type WorkerResultResponse = [
  /**
   * type
   */
  WorkerResponseType.RESULT,
  /**
   * taskId
   */
  number,
  /**
   * result
   */
  Envelope,
];

export type WorkerErrorResponse = [
  /**
   * type
   */
  WorkerResponseType.ERROR,
  /**
   * taskId
   */
  number,
  /**
   * error
   */
  string,
  /**
   * code
   */
  string | undefined,
];

export type WorkerResponsePayload = WorkerResultResponse | WorkerErrorResponse;

export type UserFunction = (
  ...args: unknown[]
) => Promise<unknown> | unknown;
