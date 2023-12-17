import "./lib/polyfills/Promise.withResolvers.ts";
import "./lib/polyfills/Worker.ts";
import { serialize } from "./lib/serialize.ts";
import { GLOBAL_FUNCTION_NAME } from "./constants.ts";
import * as $ from "./lib/keys.ts";
import { InitEvent, InvocationEvent } from "./lib/types";
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
) => CommonGenerator<any, TReturn, void>;

export function threaded<T extends Array<unknown>, TReturn>(
  fn: UserFunction<T, TReturn>
): (...args: T) => Promise<TReturn> {
  let context: Record<string, any>;
  const workerPool: Worker[] = [];
  const invocationQueue = new Map<number, PromiseWithResolvers<TReturn>>();

  workerPools.set(fn, workerPool);

  const workerCount =
    typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4;
  let invocationCount = 0;

  const init = (async () => {
    let fnStr = fn.toString();

    // @ts-ignore - Call function without arguments
    const gen = fn();
    const result = await gen.next();
    context = result.value;

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

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(
        "data:text/javascript;charset=utf-8," +
          encodeURIComponent(
            [`globalThis.pid = ${i};`, ...workerCode].join("\n")
          ),
        {
          type: "module",
        }
      );

      setupWorkerListeners(
        worker,
        context,
        valueOwnershipQueue,
        invocationQueue
      );

      workerPool.push(worker);

      worker.postMessage({
        [$.EventType]: $.Init,
        [$.EventValue]: {
          [$.ProcessId]: i,
          [$.Variables]: serializedVariables,
        },
      } satisfies InitEvent);
    }
  })();

  return async (...args) => {
    await init;

    const worker = workerPool[invocationCount % workerCount];

    const pwr = Promise.withResolvers<TReturn>();
    invocationQueue.set(invocationCount, pwr);

    worker.postMessage({
      [$.EventType]: $.Invocation,
      [$.EventValue]: {
        [$.InvocationId]: invocationCount++,
        [$.Args]: args,
      },
    } satisfies InvocationEvent);

    return pwr.promise;
  };
}
