import { ClaimAcceptanceEvent, InitEvent, ThreadEvent } from "./types";
import { replaceContents } from "./replaceContents.ts";
import * as $ from "./keys.ts";

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
  invocationQueue: Map<number, PromiseWithResolvers<TReturn>>
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
        const queue = valueOwnershipQueue.get(value)!;

        // Check if worker is first in queue
        if (queue[0] !== worker) break;

        const newValue = data[$.NewValue];

        // Update local value with new value.
        replaceContents(value, newValue);

        queue.shift();

        if (queue.length > 0) {
          announceOwnership(queue, valueName, value);
          // setTimeout(() => {
          // }, 500);
        }
        break;
      }
    }
  };

  worker.onerror = (err) => {
    invocationQueue.forEach(({ reject }) => reject(err));
  };
}
