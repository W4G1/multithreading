import { deserialize, serialize } from "./shared.ts";
import type { ThreadTask, WorkerResponsePayload } from "./types.ts";

/**
 * In Vite, the worker detection will only work if the new URL() constructor is used directly inside the new Worker() declaration.
 * Additionally, all options parameters must be static values (i.e. string literals).
 */
let newWorker: () => Worker;

export function workerOverride(fn: () => Worker) {
  newWorker = fn;
}

export class WorkerPool {
  private workers: Worker[] = [];
  private workerLoad = new Map<Worker, number>();
  private pending = new Map<
    Worker,
    Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>
  >();

  private codeCache = new Map<string, Promise<string>>();
  private maxThreads: number;
  private taskIdCounter = 0;

  constructor(maxThreads?: number) {
    this.maxThreads = maxThreads ?? navigator.hardwareConcurrency ?? 4;
  }

  private spawnWorker(): Worker {
    const worker = newWorker();
    this.pending.set(worker, new Map());
    this.workerLoad.set(worker, 0);

    // 1. Success / Task Error Handler
    worker.onmessage = (e: MessageEvent<WorkerResponsePayload>) => {
      const { taskId, type } = e.data;
      const workerPending = this.pending.get(worker);
      const p = workerPending?.get(taskId);

      if (p) {
        this.workerLoad.set(
          worker,
          Math.max(0, this.workerLoad.get(worker) ?? 0 - 1),
        );

        if (type === "ERROR") {
          const err = new Error(e.data.error);
          if (e.data.stack) err.stack = e.data.stack;
          p.reject(err);
        } else {
          // Rehydrate the result (Restore Mutex/Channel methods)
          const result = deserialize(e.data.result);
          p.resolve(result);
        }
        workerPending?.delete(taskId);
      }
    };

    // 2. Crash Handler
    worker.onerror = (e) => {
      e.preventDefault();
      const workerPending = this.pending.get(worker);
      if (workerPending) {
        for (const [_, p] of workerPending) {
          p.reject(new Error(`Worker Crashed: ${e.message}`));
        }
        workerPending.clear();
      }
      this.workerLoad.delete(worker);
      this.pending.delete(worker);
      this.workers = this.workers.filter((w) => w !== worker);
    };

    this.workers.push(worker);
    return worker;
  }

  async submit(task: ThreadTask): Promise<any> {
    const { fnId, code, args } = task;

    // Select Worker (Least Loaded)
    let selectedWorker: Worker;
    if (this.workers.length < this.maxThreads) {
      selectedWorker = this.spawnWorker();
    } else {
      selectedWorker = this.workers.reduce((prev, curr) => {
        const prevLoad = this.workerLoad.get(prev)!;
        const currLoad = this.workerLoad.get(curr)!;
        return prevLoad < currLoad ? prev : curr;
      });
    }

    const { promise, resolve, reject } = Promise.withResolvers();

    const taskId = this.taskIdCounter++;
    this.pending.get(selectedWorker)!.set(taskId, { resolve, reject });
    this.workerLoad.set(
      selectedWorker,
      (this.workerLoad.get(selectedWorker) || 0) + 1,
    );

    // Serialize Args & Unify Transferables
    const serializedArgs = args.map(serialize);
    const values = serializedArgs.map((r) => r.value);
    const transferList = [
      ...new Set(serializedArgs.flatMap((r) => r.transfer)),
    ];

    selectedWorker.postMessage(
      {
        type: "RUN",
        taskId,
        fnId,
        code,
        args: values,
      },
      { transfer: transferList },
    );

    return await promise;
  }

  terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.workerLoad.clear();
    this.pending.clear();
    this.codeCache.clear();
  }
}
