import EventTarget from "./EventTarget.ts";

export default Worker instanceof Promise
  ? (async () => {
      const { default: threads } = await import("node:worker_threads");

      return class WorkerGlobalScope extends EventTarget {
        postMessage(data, transferList) {
          threads.parentPort!.postMessage(data, transferList);
        }
        // Emulates https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope/close
        close() {
          process.exit();
        }
      };
    })()
  : undefined;
