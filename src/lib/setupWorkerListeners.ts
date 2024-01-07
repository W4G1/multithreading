import {
  ClaimAcceptanceEvent,
  InitEvent,
  MainEvent,
  ThreadEvent,
} from "./types";
import { replaceContents } from "./replaceContents.ts";
import * as $ from "./keys.ts";
import { getErrorPreview } from "./getErrorPreview.ts";
import { red, reset } from "./colors.ts";

function announceOwnership(queue: Worker[], valueName: string, value: Object) {
  // Get first worker in queue
  const worker = queue[0];

  worker.postMessage({
    [$.EventType]: $.ClaimAcceptance,
    [$.EventValue]: {
      [$.Name]: valueName,
      [$.Value]: value,
    },
  } satisfies ClaimAcceptanceEvent);
}

export function setupWorkerListeners<TReturn>(
  worker: Worker,
  context: Record<string, any>,
  valueOwnershipQueue: WeakMap<Object, Worker[]>,
  invocationQueue: Map<number, PromiseWithResolvers<TReturn>>,
  workerPool: Worker[],
  workerCodeString: string,
  pid: number
) {
  worker.onmessage = (e: MessageEvent<ThreadEvent>) => {
    switch (e.data[$.EventType]) {
      case $.Return:
        const invocationId = e.data[$.EventValue][$.InvocationId];
        const value = e.data[$.EventValue][$.Value];

        const { resolve } = invocationQueue.get(invocationId)!;
        resolve(value);
        invocationQueue.delete(invocationId);
        break;
      case $.Claim: {
        const valueName = e.data[$.EventValue];
        const value = context[valueName];
        const queue = valueOwnershipQueue.get(value)!;
        queue.push(worker);

        if (queue.length === 1) {
          announceOwnership(queue, valueName, value);
        }
        break;
      }
      case $.Unclaim: {
        const data = e.data[$.EventValue];
        const valueName = data[$.Name];
        const value = context[valueName];
        const ownershipQueue = valueOwnershipQueue.get(value)!;

        // Check if worker is first in queue
        if (ownershipQueue[0] !== worker) break;

        const newValue = data[$.Value];

        // Update local value with new value
        replaceContents(value, newValue);

        // Synchronize all other workers with new value
        for (const otherWorker of workerPool) {
          if (otherWorker === worker) continue;
          worker.postMessage({
            [$.EventType]: $.Synchronization,
            [$.EventValue]: {
              [$.Name]: valueName,
              [$.Value]: newValue,
            },
          } satisfies MainEvent);
        }

        ownershipQueue.shift();

        if (ownershipQueue.length > 0) {
          announceOwnership(ownershipQueue, valueName, value);
        }
        break;
      }
      case $.Error: {
        const error = e.data[$.EventValue];
        error.message = getErrorPreview(error as Error, workerCodeString, pid);
        error.stack = ""; // Deno doesn't like custom stack traces, use message instead
        invocationQueue.forEach(({ reject }) => reject(error));
      }
    }
  };
}
