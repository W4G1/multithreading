import "./polyfills/mod.ts";

import { getCallerLocation } from "./caller_location.ts";
import { patchDynamicImports } from "./patch_import.ts";
import { WorkerPool } from "./pool.ts";
import type { JoinHandle, Result, ThreadTask } from "./types.ts";
import { toSerialized } from "./shared.ts";
import { Mutex } from "./sync/mutex.ts";
import { Condvar } from "./sync/condvar.ts";
import { RwLock } from "./sync/rwlock.ts";
import { Receiver, Sender } from "./sync/mpmc.ts";
import { Semaphore } from "./sync/semaphore.ts";

export * from "./sync/mod.ts";
export { SharedJsonBuffer } from "./json_buffer.ts";

let globalPool: WorkerPool | null = null;
const functionIdCache = new WeakMap<Function, string>();
let globalConfig = { maxWorkers: navigator.hardwareConcurrency || 4 };

export function initRuntime(config: { maxWorkers: number }) {
  if (globalPool) throw new Error("Runtime already initialized");
  globalConfig = { ...globalConfig, ...config };
}

function getPool(): WorkerPool {
  if (!globalPool) {
    globalPool = new WorkerPool(globalConfig.maxWorkers);
  }
  return globalPool;
}

/**
 * A branded type that ensures the array has been explicitly marked
 * by the move() function.
 */
const moveTag = Symbol.for("Thread.move");
export type MovedData<T extends any[]> = T & { readonly [moveTag]: true };

export function move<Args extends any[]>(...args: Args): MovedData<Args> {
  for (const arg of args) {
    const isRawSAB = arg instanceof SharedArrayBuffer;
    // Check if it's a TypedArray (e.g. Uint8Array) viewing a Shared buffer
    const isViewSAB = ArrayBuffer.isView(arg) &&
      arg.buffer instanceof SharedArrayBuffer;
    const isThreadSafe = arg instanceof Mutex || arg instanceof Condvar ||
      arg instanceof RwLock || arg instanceof Sender ||
      arg instanceof Receiver || arg instanceof Semaphore;
    const isLibrarySAB = !isThreadSafe &&
      typeof arg[toSerialized] !== "undefined";

    if (isRawSAB || isViewSAB || isLibrarySAB) {
      console.warn(
        "Warning: You are passing a SharedArrayBuffer to a worker without locking. Please wrap this data in a Mutex() or RwLock() to prevent race conditions.",
      );
    }
  }

  return Object.defineProperty(args, moveTag, {
    enumerable: false,
    configurable: false,
    writable: false,
    value: true,
  }) as MovedData<Args>;
}

export function drop<T extends Disposable>(resource: T) {
  resource[Symbol.dispose]();
}

// Overload 1: With Move Data
export function spawn<Args extends any[], R>(
  payload: MovedData<Args>,
  fn: (this: void, ...args: Args) => R | Promise<R>,
): JoinHandle<R>;

// Overload 2: Raw Function (No Args)
export function spawn<R>(
  fn: (this: void) => R | Promise<R>,
): JoinHandle<R>;

// Implementation
export function spawn(arg1: any, arg2?: any): JoinHandle<any> {
  const pool = getPool();
  const { resolve, reject, promise } = Promise.withResolvers<
    Result<any, Error>
  >();

  let args: any[] = [];
  let fn: Function;

  // Runtime Logic: Keeps checking for the Symbol
  if (arg1 && Object.prototype.hasOwnProperty.call(arg1, moveTag)) {
    args = arg1;
    fn = arg2;
  } else {
    fn = arg1;
  }

  let fnId = functionIdCache.get(fn);
  if (!fnId) {
    fnId = Math.random().toString().slice(2);
    functionIdCache.set(fn, fnId);
  }

  const callerLocation = getCallerLocation();

  (async () => {
    try {
      const finalCode = patchDynamicImports(
        "export default " + fn.toString(),
        callerLocation.filePath,
      );

      const task: ThreadTask = {
        fnId,
        code: finalCode,
        args,
      };

      try {
        const val = await pool.submit(task);
        resolve({ ok: true, value: val });
      } catch (err) {
        resolve({ ok: false, error: err as Error });
      }
    } catch (err) {
      console.error(err);
      resolve({
        ok: false,
        error: err instanceof Error
          ? err
          : new Error("Failed to extract function source"),
      });
    }
  })();

  return {
    join: () => promise,
    abort: () => reject(new Error("Task aborted")),
  };
}

export function shutdown() {
  if (globalPool) {
    globalPool.terminate();
  }
}
