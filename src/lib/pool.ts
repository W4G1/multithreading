import {
  deserialize,
  serialize,
  WorkerResponseType,
  WorkerTaskType,
} from "./shared.ts";
import type {
  ThreadTask,
  WorkerResponsePayload,
  WorkerTaskPayload,
} from "./types.ts";

let newWorker: () => Worker;

export function workerOverride(fn: () => Worker) {
  newWorker = fn;
}

// Reusable empty array to prevent GC thrashing
const EMPTY_ARRAY: any = [];

export class WorkerPool {
  // SoA: Separate arrays for cache locality
  private workers: (Worker | undefined)[] = [];
  private loadCounts: Int32Array;
  private affinities: (Set<number> | undefined)[] = [];

  // Ring Buffer for callbacks (Power of 2 size)
  private pendingResolves: Array<((val: any) => void) | null>;
  private pendingRejects: Array<((err: any) => void) | null>;
  private taskIdMask: number;

  private maxThreads: number;
  private taskIdCounter: number = 0;

  constructor(maxThreads?: number) {
    this.maxThreads = maxThreads || navigator.hardwareConcurrency || 4;

    // Fixed size buffers
    this.workers = new Array(this.maxThreads);
    this.affinities = new Array(this.maxThreads);
    this.loadCounts = new Int32Array(this.maxThreads);

    // Ring Buffer Setup (Size 65536)
    const bufferSize = 1 << 16;
    this.taskIdMask = bufferSize - 1;
    this.pendingResolves = new Array(bufferSize).fill(null);
    this.pendingRejects = new Array(bufferSize).fill(null);
  }

  // Hot-path serialization using manual loops
  private processArgs(args: any[]): [any[], Transferable[]] {
    const len = args.length;
    if (len === 0) return [EMPTY_ARRAY, EMPTY_ARRAY];

    const values = new Array(len);
    const transfers: Transferable[] = [];

    for (let i = 0; i < len; i++) {
      const serialized = serialize(args[i]);
      values[i] = serialized[0];

      const transList = serialized[1];
      if (transList && transList.length > 0) {
        const tLen = transList.length;
        for (let j = 0; j < tLen; j++) {
          transfers.push(transList[j]!);
        }
      }
    }
    return [values, transfers];
  }

  private createWorker(index: number): Worker {
    const worker = newWorker();

    worker.onmessage = (e: MessageEvent<WorkerResponsePayload>) => {
      const type = e.data[0];
      const taskId = e.data[1];

      // Direct Memory Access: Decrement load
      this.loadCounts[index]!--;

      // Ring Buffer Lookup (Bitwise AND)
      const slot = taskId & this.taskIdMask;
      const resolve = this.pendingResolves[slot];
      const reject = this.pendingRejects[slot];

      // Nullify slot immediately
      this.pendingResolves[slot] = null;
      this.pendingRejects[slot] = null;

      if (resolve) {
        if (type === WorkerResponseType.ERROR) {
          const err = new Error(e.data[2]);
          if (e.data[3]) err.stack = e.data[3];
          reject!(err);
        } else {
          resolve(deserialize(e.data[2]));
        }
      }
    };

    worker.onerror = (e) => {
      e.preventDefault();
      this.nukeWorker(index);
    };

    this.workers[index] = worker;
    this.affinities[index] = new Set();
    return worker;
  }

  private nukeWorker(index: number) {
    if (this.workers[index]) {
      this.workers[index]!.terminate();
    }
    this.workers[index] = undefined;
    this.loadCounts[index] = 0;
    this.affinities[index] = undefined;
  }

  submit(task: ThreadTask): Promise<any> {
    const fnId = task[0];

    // Bitwise optimized scheduler
    // Rank = (Load << 1) | (NoAffinity ? 1 : 0)
    // Lower Rank is better.

    let bestIdx = -1;
    let bestRank = 0x7FFFFFFF; // Max Int32

    // Hoist array references to local scope to avoid `this.` lookups in loop
    const loads = this.loadCounts;
    const affinities = this.affinities;
    const threads = this.maxThreads;
    const workers = this.workers;

    for (let i = 0; i < threads; i++) {
      // Check if slot is empty
      if (!workers[i]) {
        // Empty slot acts as "Rank -1" (Infinite Preference) because it allows scaling up.
        // We break immediately to spawn a new worker if we haven't found a perfect idle one yet.
        if (bestRank > 0) {
          bestIdx = i;
          bestRank = -1;
          break;
        }
        continue;
      }

      const load = loads[i]!;
      // Bitwise Pack:
      // If affinity exists (has(fnId)), right bit is 0. Else 1.
      // This adds a penalty of "0.5 load" to workers without code.
      const rank = (load << 1) | (affinities[i]!.has(fnId) ? 0 : 1);

      if (rank < bestRank) {
        bestIdx = i;
        bestRank = rank;

        // If Rank is 0 (Idle + Affinity), it is unbeatable.
        if (rank === 0) break;
      }
    }

    let worker: Worker;
    let isNew = false;

    if (bestRank === -1) {
      worker = this.createWorker(bestIdx);
      isNew = true;
    } else {
      worker = workers[bestIdx]!;
    }

    const { promise, resolve, reject } = Promise.withResolvers();
    const id = this.taskIdCounter++;
    const slot = id & this.taskIdMask;

    this.pendingResolves[slot] = resolve;
    this.pendingRejects[slot] = reject;

    loads[bestIdx]!++;

    const [values, transferList] = this.processArgs(task[2]);

    // Update Affinity (only if needed)
    if (!isNew) {
      const aff = affinities[bestIdx]!;
      if (!aff.has(fnId)) aff.add(fnId);
    } else {
      // New workers already have the Set created in createWorker
      affinities[bestIdx]!.add(fnId);
    }

    const sendCode = isNew || (bestRank & 1) === 1;

    worker.postMessage(
      [
        WorkerTaskType.RUN,
        id,
        fnId,
        values,
        sendCode ? task[1] : undefined,
      ] as WorkerTaskPayload,
      transferList,
    );

    return promise;
  }

  terminate() {
    for (const w of this.workers) w?.terminate();
    this.workers = [];
  }
}
