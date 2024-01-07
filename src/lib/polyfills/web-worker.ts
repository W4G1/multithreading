import "./Worker.ts";
import Event from "./Event.ts";
import ErrorEvent from "./ErrorEvent.ts";
import WorkerGlobalScopePromise from "./WorkerGlobalScope.ts";
import PromiseRejectionEvent from "./PromiseRejectionEvent.ts";

Worker instanceof Promise &&
  (async () => {
    const { default: threads } = await import("node:worker_threads");
    const { default: VM } = await import("node:vm");

    const WorkerGlobalScope = await WorkerGlobalScopePromise!;

    return threads.isMainThread || workerThread();

    async function workerThread() {
      let { mod, name, type } = threads.workerData;
      if (!mod) return await Worker;

      // turn global into a mock WorkerGlobalScope
      const self = (global.self = global);

      // enqueue messages to dispatch after modules are loaded
      let queue: Event[] | null = [];

      function flushQueue() {
        const buffered = queue;
        queue = null;
        buffered!.forEach((event) => {
          self.dispatchEvent(event);
        });
      }

      threads.parentPort!.on("message", (data) => {
        const event = new Event("message");
        event.data = data;
        if (queue == null) self.dispatchEvent(event);
        else queue.push(event);
      });

      threads.parentPort!.on("error", (error) => {
        error.type = "Error";
        self.dispatchEvent(new ErrorEvent({ error }));
      });

      process.on("unhandledRejection", (reason, promise) => {
        self.dispatchEvent(new PromiseRejectionEvent({ reason, promise }));
      });

      process.on("uncaughtException", (error, origin) => {
        self.dispatchEvent(new ErrorEvent({ error }));
      });

      let proto = Object.getPrototypeOf(global);
      delete proto.constructor;
      Object.defineProperties(WorkerGlobalScope.prototype, proto);
      proto = Object.setPrototypeOf(global, new WorkerGlobalScope());
      [
        "postMessage",
        "addEventListener",
        "removeEventListener",
        "dispatchEvent",
      ].forEach((fn) => {
        proto[fn] = proto[fn].bind(global);
      });
      global.name = name;

      const isDataUrl = /^data:/.test(mod);

      if (type === "module") {
        import(mod)
          .catch((err) => {
            if (isDataUrl && err.message === "Not supported") {
              console.warn(
                "Worker(): Importing data: URLs requires Node 12.10+. Falling back to classic worker."
              );
              return evaluateDataUrl(mod, name);
            }
            console.error(err);
          })
          .then(flushQueue);
      } else {
        try {
          if (isDataUrl) {
            evaluateDataUrl(mod, name);
          } else {
            require(mod);
          }
        } catch (err) {
          console.error(err);
        }
        Promise.resolve().then(flushQueue);
      }
    }

    function evaluateDataUrl(url: string, name: string) {
      const { data } = parseDataUrl(url);
      return VM.runInThisContext(data, {
        filename: "worker.<" + (name || "data:") + ">",
      });
    }

    function parseDataUrl(url: string) {
      let [m, type, encoding, data] =
        url.match(/^data: *([^;,]*)(?: *; *([^,]*))? *,(.*)$/) || [];
      if (!m) throw Error("Invalid Data URL.");
      if (encoding)
        switch (encoding.toLowerCase()) {
          case "base64":
            data = Buffer.from(data, "base64").toString();
            break;
          default:
            throw Error('Unknown Data URL encoding "' + encoding + '"');
        }
      return { type, data };
    }
  })();
