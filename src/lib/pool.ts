import { deserialize, serialize } from "./shared.ts";
import type { ThreadTask, WorkerResponsePayload } from "./types.ts";

let newWorker: () => Worker;

export function workerOverride(fn: () => Worker) {
  newWorker = fn;
}

interface TrackedWorker extends Worker {
  // Set of function IDs this worker has already compiled
  _loadedFnIds: Set<string>;
  _pending: Map<
    number,
    { resolve: (val: any) => void; reject: (err: any) => void }
  >;
}

export class WorkerPool {
  private workers: TrackedWorker[] = [];
  private maxThreads: number;
  private taskIdCounter = 0;

  constructor(maxThreads?: number) {
    this.maxThreads = maxThreads || navigator.hardwareConcurrency || 4;
  }

  private createWorker(): TrackedWorker {
    const worker = newWorker() as TrackedWorker;

    worker._loadedFnIds = new Set();
    worker._pending = new Map();

    worker.onmessage = (e: MessageEvent<WorkerResponsePayload>) => {
      const { taskId, type } = e.data;
      const p = worker._pending.get(taskId);

      if (p) {
        if (type === "ERROR") {
          const err = new Error(e.data.error);
          if (e.data.stack) err.stack = e.data.stack;
          p.reject(err);
        } else {
          p.resolve(deserialize(e.data.result));
        }
        worker._pending.delete(taskId);
      }
    };

    worker.onerror = (e) => {
      e.preventDefault();
      const err = new Error(`Worker Crashed: ${e.message}`);
      for (const p of worker._pending.values()) p.reject(err);
      worker._pending.clear();
      this.removeWorker(worker);
    };

    this.workers.push(worker);
    return worker;
  }

  private removeWorker(worker: TrackedWorker) {
    this.workers = this.workers.filter((w) => w !== worker);
    worker.terminate();
  }

  private async executeTask(
    worker: TrackedWorker,
    task: ThreadTask,
  ): Promise<any> {
    const { fnId, code, args } = task;
    const taskId = this.taskIdCounter++;

    const { promise, resolve, reject } = Promise.withResolvers();

    worker._pending.set(taskId, { resolve, reject });

    const serializedArgs = args.map(serialize);
    const values = serializedArgs.map((r) => r.value);
    const transferList = [
      ...new Set(serializedArgs.flatMap((r) => r.transfer)),
    ];

    const hasCode = worker._loadedFnIds.has(fnId);
    if (!hasCode) {
      worker._loadedFnIds.add(fnId);
    }

    worker.postMessage(
      {
        type: "RUN",
        taskId,
        fnId,
        code: hasCode ? undefined : code,
        args: values,
      },
      { transfer: transferList },
    );

    return await promise;
  }

  async submit(task: ThreadTask): Promise<any> {
    let bestCandidate: TrackedWorker | undefined;
    let bestCandidateLoad = Infinity;
    // Score: 0 = Idle+Affinity, 1 = Idle, 2 = Busy+Affinity, 3 = Busy
    let bestCandidateScore = 4;

    for (let i = 0; i < this.workers.length; i++) {
      const w = this.workers[i]!;
      const load = w._pending.size;
      const hasAffinity = w._loadedFnIds.has(task.fnId);

      if (load === 0 && hasAffinity) {
        return await this.executeTask(w, task);
      }

      let score = 4;
      if (load === 0) score = 1;
      else if (hasAffinity) score = 2;
      else score = 3;

      if (
        score < bestCandidateScore ||
        (score === bestCandidateScore && load < bestCandidateLoad)
      ) {
        bestCandidate = w;
        bestCandidateScore = score;
        bestCandidateLoad = load;
      }
    }

    if (bestCandidateScore >= 2 && this.workers.length < this.maxThreads) {
      return await this.executeTask(this.createWorker(), task);
    }

    if (bestCandidate) {
      return await this.executeTask(bestCandidate, task);
    }

    return await this.executeTask(this.createWorker(), task);
  }

  terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
  }
}
