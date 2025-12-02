import { deserialize, serialize, type WorkerTaskPayload } from "./shared.ts";

// Applies necessary polyfills for certain runtimes
import "./polyfills/mod.ts";

// Import for side-effects: This triggers the static { register(this) } blocks
import "./json_buffer.ts";
import "./sync/mutex.ts";
import "./sync/condvar.ts";
import "./sync/rwlock.ts";

export type Fanthom = never;

const functionRegistry = new Map<string, (...args: any[]) => any>();

self.onmessage = async (event: MessageEvent<WorkerTaskPayload>) => {
  const { type, taskId, fnId, code, args: rawArgs } = event.data;

  if (type === "RUN") {
    try {
      const args = rawArgs.map(deserialize);

      let fn = functionRegistry.get(fnId);
      if (!fn) {
        const blob = new Blob([code], {
          type: "text/javascript",
        });
        const blobUrl = URL.createObjectURL(blob);
        const mod = await import(blobUrl);
        URL.revokeObjectURL(blobUrl);

        fn = mod.default;

        functionRegistry.set(fnId, fn!);
      }

      let result = fn!(...args);

      if (result instanceof Promise) result = await result;

      const { value: serializedResult, transfer: transferList } = serialize(
        result,
      );

      self.postMessage(
        { type: "RESULT", taskId, result: serializedResult },
        { transfer: transferList },
      );
    } catch (err) {
      console.error(err);

      const error = err instanceof Error ? err : new Error(String(err));

      self.postMessage({
        type: "ERROR",
        taskId,
        error: error.message,
        stack: error.stack,
      });
    }
  }
};

self.onerror = (e: ErrorEvent) => {
  console.error(e.message, e);
};
