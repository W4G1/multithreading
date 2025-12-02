// @ts-nocheck This is a polyfill file
import {
  isMainThread,
  parentPort,
  Worker as NodeWorker,
} from "node:worker_threads";
import { cpus } from "node:os";

const isNode = typeof process !== "undefined" &&
  typeof process?.versions?.node === "string" &&
  !("Deno" in globalThis) &&
  !("Bun" in globalThis);

if (isNode) {
  globalThis.self = globalThis;

  globalThis.navigator ??= globalThis.navigator ?? {};
  globalThis.navigator.hardwareConcurrency ??= cpus().length;

  // Force "ErrorEvent"
  globalThis.ErrorEvent = class ErrorEvent extends Event {
    public message: string;
    public filename: string;
    public lineno: number;
    public colno: number;
    public error: any;

    constructor(type: string, init?: ErrorEventInit) {
      super(type, init);
      this.message = init?.message || "";
      this.filename = init?.filename || "";
      this.lineno = init?.lineno || 0;
      this.colno = init?.colno || 0;
      this.error = init?.error || null;
    }
  };

  if (isMainThread) {
    // Directly overwrite global Worker
    globalThis.Worker = class Worker extends EventTarget {
      private _worker: any;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super();
        const urlStr = scriptURL.toString();
        const finalPath = urlStr.startsWith("file://")
          ? new URL(urlStr)
          : urlStr;

        this._worker = new NodeWorker(finalPath, { ...options });

        this._worker.on("message", (data: any) => {
          const event = new MessageEvent("message", { data });
          this.dispatchEvent(event);
          if (this.onmessage) this.onmessage(event);
        });

        this._worker.on("error", (error: Error) => {
          const event = new ErrorEvent("error", {
            error,
            message: error.message,
          });
          this.dispatchEvent(event);
          if (this.onerror) this.onerror(event);
        });

        this._worker.on("exit", (code: number) => {
          if (code !== 0) {
            const err = new Error(`Worker stopped with exit code ${code}`);
            const event = new ErrorEvent("error", {
              error: err,
              message: err.message,
            });
            this.dispatchEvent(event);
            if (this.onerror) this.onerror(event);
          }
        });
      }

      postMessage(message: any, transfer: Transferable[]) {
        this._worker.postMessage(message, transfer);
      }

      terminate() {
        this._worker.terminate();
      }

      public onmessage: ((this: Worker, ev: MessageEvent) => any) | null = null;
      public onerror: ((this: Worker, ev: ErrorEvent) => any) | null = null;
    };
  }

  if (!isMainThread && parentPort) {
    // A. Polyfill postMessage
    globalThis.postMessage = (message: any, transfer?: Transferable[]) => {
      parentPort.postMessage(message, transfer);
    };

    // B. Polyfill onmessage
    let currentHandler = globalThis.onmessage;

    parentPort.on("message", (data) => {
      if (currentHandler) {
        const event = new MessageEvent("message", { data });
        currentHandler(event);
      }
    });

    Object.defineProperty(globalThis, "onmessage", {
      get: () => currentHandler,
      set: (fn) => {
        currentHandler = fn;
      },
      configurable: true,
      enumerable: true,
    });

    // C. Blob & URL Polyfill
    class SyncBlob {
      parts: any[];
      type: string;
      constructor(blobParts: any[], options?: BlobPropertyBag) {
        this.parts = blobParts;
        this.type = options?.type || "";
      }
    }

    // Overwrite global Blob
    globalThis.Blob = SyncBlob;

    const originalCreateObjectURL = globalThis.URL.createObjectURL;

    // Overwrite URL.createObjectURL
    globalThis.URL.createObjectURL = (blob: any) => {
      if (blob instanceof SyncBlob) {
        const code = blob.parts.join("");
        const b64 = Buffer.from(code).toString("base64");
        return `data:${blob.type};base64,${b64}`;
      }

      if (originalCreateObjectURL) {
        return originalCreateObjectURL(blob);
      }

      throw new Error(
        "URL.createObjectURL polyfill: Argument is not a SyncBlob",
      );
    };

    globalThis.URL.revokeObjectURL = () => {};
  }
}
