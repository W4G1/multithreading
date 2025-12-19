import { getCallerLocation } from "./caller_location.ts";
import { patchDynamicImports } from "./patch_import.ts";
import { WorkerPool } from "./pool.ts";
import type { JoinHandle, Result, ThreadTask, UserFunction } from "./types.ts";
import { checkMoveArgs } from "./check_move_args.ts";

export * from "./sync/mod.ts";
export { SharedJsonBuffer } from "./json_buffer.ts";

let globalPool: WorkerPool | null = null;
let globalConfig = { maxWorkers: navigator.hardwareConcurrency || 4 };

const globalFunctionRegistry = new WeakMap<
  UserFunction,
  { id: string; code: string }
>();

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
const moveTag = Symbol("Thread.move");
export type MovedData<T extends any[]> = T & { readonly [moveTag]: true };

export function move<Args extends any[]>(...args: Args): MovedData<Args> {
  checkMoveArgs(args);

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

export function spawn(arg1: any, arg2?: any): JoinHandle<any> {
  const pool = getPool();
  const { resolve, reject, promise } = Promise.withResolvers<
    Result<any, Error>
  >();

  let args: any[] = [];
  let fn: UserFunction;

  // Argument parsing
  if (arg1 && Object.prototype.hasOwnProperty.call(arg1, moveTag)) {
    args = arg1;
    fn = arg2;
  } else {
    fn = arg1;
  }

  let meta = globalFunctionRegistry.get(fn);

  if (!meta) {
    // Cache miss: Generate ID and patch code
    const id = Math.random().toString(36).slice(2);
    const callerLocation = getCallerLocation();

    // We wrap this in a try-catch block inside the cache logic
    // to fail early if toString fails
    try {
      const code = patchDynamicImports(
        "export default " + fn.toString(),
        callerLocation.filePath,
      );
      meta = { id, code };
      globalFunctionRegistry.set(fn, meta);
    } catch (err) {
      console.error(err);
      return {
        join: () =>
          Promise.resolve({
            ok: false,
            error: err instanceof Error
              ? err
              : new Error("Failed to compile function"),
          }),
        abort: () => {},
      };
    }
  }

  // Task submission
  (async () => {
    try {
      const task: ThreadTask = {
        fnId: meta!.id,
        code: meta!.code,
        args,
      };

      const val = await pool.submit(task);
      resolve({ ok: true, value: val });
    } catch (err) {
      resolve({ ok: false, error: err as Error });
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
    globalPool = null;
  }
}

const isWorker = typeof globalThis.WorkerGlobalScope !== "undefined" &&
  self instanceof globalThis.WorkerGlobalScope;

export const isMainThread = !isWorker;
export const isWorkerThread = isWorker;
