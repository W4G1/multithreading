import "./lib/polyfills/Promise.withResolvers.ts";
import { serialize } from "./lib/serialize.ts";
import { GLOBAL_FUNCTION_NAME } from "./constants.ts";
import * as $ from "./lib/keys.ts";
import { MainEvent } from "./lib/types";
import { setupWorkerListeners } from "./lib/setupWorkerListeners.ts";

const INLINE_WORKER = `__INLINE_WORKER__`;

export async function $claim(value: Object) {}
export function $unclaim(value: Object) {}

const workerPools = new WeakMap<Function, Worker[]>();
const valueOwnershipQueue = new WeakMap<Object, Worker[]>();

// Either AsyncGenerator or Generator
type CommonGenerator<T, TReturn, TNext> =
  | AsyncGenerator<T, TReturn, TNext>
  | Generator<T, TReturn, TNext>;

type UserFunction<T extends Array<unknown> = [], TReturn = void> = (
  ...args: T
) => CommonGenerator<
  any,
  TReturn,
  {
    $claim: typeof $claim;
    $unclaim: typeof $unclaim;
  }
>;

interface ThreadedConfig {
  debug: boolean;
  maxThreads: number;
}

export function threaded<T extends Array<unknown>, TReturn>(
  fn: UserFunction<T, TReturn>
): ((...args: T) => Promise<TReturn>) & { dispose: () => void };

export function threaded<T extends Array<unknown>, TReturn>(
  config: Partial<ThreadedConfig>,
  fn: UserFunction<T, TReturn>
): ((...args: T) => Promise<TReturn>) & { dispose: () => void };

export function threaded<T extends Array<unknown>, TReturn>(
  configOrFn: Partial<ThreadedConfig> | UserFunction<T, TReturn>,
  maybeFn?: UserFunction<T, TReturn>
): ((...args: T) => Promise<TReturn>) & { dispose: () => void } {
  const config: ThreadedConfig = {
    debug: false,
    maxThreads:
      typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4,
  };
  let fn: UserFunction<T, TReturn>;

  if (typeof configOrFn === "function") {
    fn = configOrFn as UserFunction<T, TReturn>;
  } else {
    Object.assign(config, configOrFn);
    fn = maybeFn as UserFunction<T, TReturn>;
  }

  let context: Record<string, any> = {};
  const workerPool: Worker[] = [];
  const invocationQueue = new Map<number, PromiseWithResolvers<TReturn>>();

  workerPools.set(fn, workerPool);

  let invocationCount = 0;

  const init = (async () => {
    let fnStr = fn.toString();
    const hasYield = fnStr.includes("yield");

    if (hasYield) {
      // @ts-ignore - Call function without arguments
      const gen = fn();
      const result = await gen.next();
      context = result.value;
    }

    for (const key in context) {
      // Initialize the ownership queue
      valueOwnershipQueue.set(context[key], []);
    }

    const workerCode = [
      `globalThis.${GLOBAL_FUNCTION_NAME} = ${fnStr}`,
      INLINE_WORKER,
    ];

    const serializedVariables = serialize(context);

    for (const [key, value] of Object.entries(serializedVariables)) {
      if (value[$.WasType] !== $.Function) continue;
      workerCode.unshift(`globalThis.${key} = ${value.value}`);

      delete serializedVariables[key];
    }

    // Polyfill for Node.js
    globalThis.Worker ??= (await import("web-worker")).default;

    for (let i = 0; i < config.maxThreads; i++) {
      const worker = new Worker(
        "data:text/javascript;charset=utf-8," +
          encodeURIComponent(workerCode.join("\n")),
        {
          type: "module",
        }
      );

      setupWorkerListeners(
        worker,
        context,
        valueOwnershipQueue,
        invocationQueue,
        workerPool
      );

      workerPool.push(worker);

      worker.postMessage({
        [$.EventType]: $.Init,
        [$.EventValue]: {
          [$.ProcessId]: i,
          [$.HasYield]: hasYield,
          [$.Variables]: serializedVariables,
          [$.DebugEnabled]: config.debug,
        },
      } satisfies MainEvent);
    }
  })();

  const wrapper = async (...args: T) => {
    await init;

    const worker = workerPool[invocationCount % config.maxThreads];

    const pwr = Promise.withResolvers<TReturn>();
    invocationQueue.set(invocationCount, pwr);

    worker.postMessage({
      [$.EventType]: $.Invocation,
      [$.EventValue]: {
        [$.InvocationId]: invocationCount++,
        [$.Args]: args,
      },
    } satisfies MainEvent);

    return pwr.promise;
  };

  wrapper.dispose = () => {
    for (const worker of workerPool) {
      worker.terminate();
    }

    workerPools.delete(fn);
    invocationQueue.forEach((pwr) => pwr.reject("Disposed"));
    invocationQueue.clear();
  };

  return wrapper;
}
