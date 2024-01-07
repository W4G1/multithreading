import "./lib/polyfills/Promise.withResolvers.ts";
import "./lib/polyfills/import.meta.resolve.ts";
import "./lib/polyfills/web-worker.ts";

import { serialize } from "./lib/serialize.ts";
import * as $ from "./lib/keys.ts";
import { MainEvent, UserFunction } from "./lib/types";
import { setupWorkerListeners } from "./lib/setupWorkerListeners.ts";
import { parseTopLevelYieldStatements } from "./lib/parseTopLevelYieldStatements.ts";

const inlineWorker = `__INLINE_WORKER__`;

export async function $claim(value: Object) {}
export function $unclaim(value: Object) {}

const workerPools = new WeakMap<UserFunction, Worker[]>();
const valueOwnershipQueue = new WeakMap<Object, Worker[]>();

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
    const fnStr = fn.toString();

    const yieldList = await parseTopLevelYieldStatements(fnStr);

    // @ts-ignore - Call function without arguments
    const gen = fn();

    for (const yieldItem of yieldList) {
      // @ts-ignore - Pass empty object to prevent TypeError when user has destructured import
      const result = await gen.next({});

      if (yieldItem[$.Type] !== "variable") continue;

      context[yieldItem[$.Name]] = result.value;
    }

    for (const key in context) {
      // Initialize the ownership queue
      valueOwnershipQueue.set(context[key], []);
    }

    const workerCode = [
      inlineWorker,
      `__internal.${$.UserFunction} = ${fnStr};`,
    ];

    const serializedVariables = serialize(context);

    for (const [key, value] of Object.entries(serializedVariables)) {
      if (value[$.WasType] !== $.Function) continue;
      // globalthis. is necessary to prevent duplicate variable names when the function is named
      workerCode.unshift(`globalThis.${key} = ${value.value};`);

      delete serializedVariables[key];
    }

    const workerCodeString = workerCode.join("\r\n");

    for (let i = 0; i < config.maxThreads; i++) {
      const worker = new (await Worker)(
        encodeURI(
          "data:application/javascript;base64," + btoa(workerCodeString)
        ),
        {
          type: "module",
        }
      );

      setupWorkerListeners(
        worker,
        context,
        valueOwnershipQueue,
        invocationQueue,
        workerPool,
        workerCodeString,
        i
      );

      workerPool.push(worker);

      worker.postMessage({
        [$.EventType]: $.Init,
        [$.EventValue]: {
          [$.ProcessId]: i,
          [$.YieldList]: yieldList,
          [$.Variables]: serializedVariables,
          [$.Code]: workerCodeString,
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
