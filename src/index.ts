import NodeWorkerPolyfill from "web-worker";
import { detectUndeclaredVariables } from "./lib/detectUndeclaredVariables";
import { modifyFunctionString } from "./lib/modifyFunctionString";
import { VariableType, WAS_KEY, serialize } from "./lib/serialize";
import { readFileSync } from "node:fs";
import { ShareableValue } from "./lib/ShareableValue";
import { GLOBAL_FUNCTION_NAME } from "./constants";

let inlineWorker = `__INLINE_WORKER__`;

export function shared<T>(value: T) {
  return new ShareableValue(value);
}

// Either AsyncGenerator or Generator
type CommonGenerator<T, TReturn, TNext> =
  | AsyncGenerator<T, TReturn, TNext>
  | Generator<T, TReturn, TNext>;

export function thread<T extends Array<unknown>, TReturn>(
  fn: (...args: T) => CommonGenerator<any, TReturn, unknown>
): (...args: T) => Promise<TReturn> {
  let fnStr = fn.toString();

  const workerCode = [
    `globalThis.${GLOBAL_FUNCTION_NAME} = ${fnStr}`,
    inlineWorker,
  ];

  const init = async () => {
    let gen: any;

    // @ts-ignore - Call function without arguments
    gen = fn();
    const { value: context } = await gen.next();
    // @ts-ignore - Early return
    gen.return();

    const serializedVariables = serialize(context);

    for (const [key, value] of Object.entries(serializedVariables)) {
      if (value[WAS_KEY] !== VariableType.Function) continue;
      workerCode.unshift(`globalThis.${key} = ${value.value}`);

      delete serializedVariables[key];
    }

    const worker = new (globalThis.Worker ?? NodeWorkerPolyfill)(
      "data:text/javascript;charset=utf-8," +
        encodeURIComponent(workerCode.join("\n")),
      {
        type: "module",
      }
    );

    return { worker, serializedVariables };
  };

  const initPromise = init();

  return (...args) =>
    new Promise((resolve, reject) => {
      initPromise.then(({ worker, serializedVariables }) => {
        worker.onmessage = (e) => resolve(e.data);
        worker.onerror = (err) => reject(err);
        worker.postMessage({
          variables: serializedVariables,
          args: args,
        });
      });
    });
}
