import EventTarget from "./EventTarget.ts";
import Event from "./Event.ts";

globalThis.Worker ??= (async () => {
  const { default: threads } = await import("node:worker_threads");
  const { URL, pathToFileURL, fileURLToPath } = await import("node:url");

  const WORKER = Symbol.for("worker");

  return class Worker extends EventTarget implements globalThis.Worker {
    constructor(url: string, options: WorkerOptions = {}) {
      super();
      const { name, type } = options;
      url += "";
      let mod;
      if (/^data:/.test(url)) {
        mod = url;
      } else {
        const baseUrl = pathToFileURL(process.cwd() + "/");

        mod = fileURLToPath(new URL(url, baseUrl));
      }

      const worker = new threads.Worker(new URL(import.meta.url), {
        workerData: { mod, name, type },
      });
      Object.defineProperty(this, WORKER, {
        value: worker,
      });
      worker.on("message", (data) => {
        const event = new Event("message");
        event.data = data;
        this.dispatchEvent(event);
      });
      worker.on("error", (error) => {
        error.type = "error";
        this.dispatchEvent(error);
      });
      worker.on("exit", () => {
        this.dispatchEvent(new Event("close"));
      });
    }

    onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null = null;
    onmessageerror: ((this: Worker, ev: MessageEvent<any>) => any) | null =
      null;
    postMessage(message: any, transfer: Transferable[]): void;
    postMessage(
      message: any,
      options?: StructuredSerializeOptions | undefined
    ): void;
    postMessage(message: unknown, options?: unknown): void {
      this[WORKER].postMessage(message, options);
    }
    terminate(): void;
    terminate(): void {
      this[WORKER].terminate();
    }
    onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null = null;
  };
})();
