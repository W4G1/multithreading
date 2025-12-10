import { deserialize, serialize, type WorkerTaskPayload } from "./shared.ts";

// Import for side-effects: This triggers the static { register(this) } blocks
import "./sync/mod.ts";
import "./json_buffer.ts";

const functionRegistry = new Map<string, (...args: any[]) => any>();

self.onmessage = async (event: MessageEvent<WorkerTaskPayload>) => {
  const { type, taskId, fnId, code, args: rawArgs } = event.data;

  if (type === "RUN") {
    // We need a stable array to hold successfully hydrated handles.
    // We cannot use .map() because if it throws halfway, we lose the
    // references to the handles that succeeded
    const activeArgs: any[] = [];

    try {
      // As soon as 'deserialize' returns, we have a live Reference Count that must be disposed.
      for (const raw of rawArgs) {
        const arg = deserialize(raw);
        activeArgs.push(arg);
      }

      let fn = functionRegistry.get(fnId);
      if (!fn) {
        const base64Code = btoa(code);
        const dataUrl = `data:text/javascript;base64,${base64Code}`;
        const mod = await import(dataUrl);
        fn = mod.default;
        functionRegistry.set(fnId, fn!);
      }

      let result = fn!(...activeArgs);

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
      console.log("[START WORKER CODE DUMP]");
      console.log(code);
      console.log("[END WORKER CODE DUMP]");

      const error = err instanceof Error ? err : new Error(String(err));

      self.postMessage({
        type: "ERROR",
        taskId,
        error: error.message,
        stack: error.stack,
      });
    } finally {
      for (const arg of activeArgs) {
        if (arg && typeof arg === "object" && Symbol.dispose in arg) {
          try {
            arg[Symbol.dispose]();
          } catch (e) {
            console.error("Failed to automatically dispose:", e);
          }
        }
      }
    }
  }
};

self.onerror = (e) => {
  console.error(e.message, e);
};
