import {
  deserialize,
  serialize,
  WorkerResponseType,
  WorkerTaskType,
} from "./shared.ts";
import type {
  UserFunction,
  WorkerErrorResponse,
  WorkerResultResponse,
  WorkerTaskPayload,
} from "./types.ts";

import "./sync/mod.ts";
import "./json_buffer.ts";

// Registry persists for the lifetime of the Worker
const functionRegistry = new Map<number, UserFunction>();

self.onmessage = async (event: MessageEvent<WorkerTaskPayload>) => {
  const [type, taskId, fnId, rawArgs, code] = event.data;

  if (type === WorkerTaskType.RUN) {
    // We need a stable array to hold successfully hydrated handles.
    // We cannot use .map() because if it throws halfway, we lose the
    // references to the handles that succeeded
    const activeArgs: any[] = new Array(rawArgs.length);

    try {
      // As soon as 'deserialize' returns, we have a live Reference Count that must be disposed.
      for (let i = 0; i < rawArgs.length; i++) {
        activeArgs[i] = deserialize(rawArgs[i]!);
      }

      let fn = functionRegistry.get(fnId);

      if (!fn) {
        // Cache miss: 'code' must be provided by the main thread logic
        if (!code) {
          throw new Error(
            `Function ID ${fnId} not found in worker registry and no code provided.`,
          );
        }

        const base64Code = btoa(code);
        const dataUrl = `data:text/javascript;base64,${base64Code}`;
        const mod = await import(dataUrl);

        fn = mod.default;
        functionRegistry.set(fnId, fn!);
      }

      let result = fn!(...activeArgs);
      if (result instanceof Promise) result = await result;

      const [serializedResult, transferList] = serialize(
        result,
      );

      self.postMessage(
        [
          WorkerResponseType.RESULT,
          taskId,
          serializedResult,
        ] as WorkerResultResponse,
        { transfer: transferList },
      );
    } catch (err) {
      console.error(err);
      // Only log code if it was sent, otherwise we know it's a registry issue
      if (code) {
        console.log("[START WORKER CODE DUMP]");
        console.log(code);
        console.log("[END WORKER CODE DUMP]");
      }

      const error = err instanceof Error ? err : new Error(String(err));

      self.postMessage([
        WorkerResponseType.ERROR,
        taskId,
        error.message,
        error.stack,
      ] as WorkerErrorResponse);
    } finally {
      for (const arg of activeArgs) {
        if (typeof arg === "object" && arg !== null && Symbol.dispose in arg) {
          try {
            arg[Symbol.dispose]();
          } catch (e) {
            console.error("Failed to dispose resource:", e);
          }
        }
      }
    }
  }
};

self.onerror = (e) => {
  console.error(e.message, e);
};
