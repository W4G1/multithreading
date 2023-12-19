import "./polyfills/Promise.withResolvers.ts";
import { GLOBAL_FUNCTION_NAME } from "../constants.ts";
import { deserialize } from "./serialize.ts";
import * as $ from "./keys.ts";
import {
  ClaimAcceptanceEvent,
  InitEvent,
  InvocationEvent,
  MainEvent,
  SynchronizationEvent,
  ThreadEvent,
} from "./types";
import { replaceContents } from "./replaceContents.ts";

declare var pid: number;

declare global {
  var pid: number;
  function $claim(value: Object): Promise<void>;
  function $unclaim(value: Object): void;
}

globalThis.onmessage = async (e: MessageEvent<MainEvent>) => {
  switch (e.data[$.EventType]) {
    case $.Init:
      Thread.handleInit(e.data[$.EventValue]);
      break;
    case $.Invocation:
      Thread.handleInvocation(e.data[$.EventValue]);
      break;
    case $.ClaimAcceptance:
      Thread.handleClaimAcceptance(e.data[$.EventValue]);
      break;
    case $.Synchronization:
  }
};

const cyanStart = "\x1b[36m";
const cyanEnd = "\x1b[39m";

const originalLog = console.log;
console.log = (...args) => {
  originalLog(`${cyanStart}[Thread_${pid}]${cyanEnd}`, ...args);
};

const $claim = async function $claim(value: Object) {
  const valueName = Thread.shareableNameMap.get(value)!;

  Thread.valueInUseCount[valueName]++;

  // First check if the variable is already (being) claimed
  if (Thread.valueClaimMap.has(valueName)) {
    return Thread.valueClaimMap.get(valueName)!.promise;
  }

  Thread.valueClaimMap.set(valueName, Promise.withResolvers<void>());

  globalThis.postMessage({
    [$.EventType]: $.Claim,
    [$.EventValue]: valueName,
  } satisfies ThreadEvent);

  return Thread.valueClaimMap.get(valueName)!.promise;
};

const $unclaim = function $unclaim(value: Object) {
  const valueName = Thread.shareableNameMap.get(value)!;

  if (--Thread.valueInUseCount[valueName] > 0) return;

  Thread.valueClaimMap.delete(valueName);
  globalThis.postMessage({
    [$.EventType]: $.Unclaim,
    [$.EventValue]: {
      [$.Name]: valueName,
      [$.Value]: value,
    },
  } satisfies ThreadEvent);
};

// Make globally available
globalThis.$claim = $claim;
globalThis.$unclaim = $unclaim;

// Separate namespace to avoid polluting the global namespace
// and avoid name collisions with the user defined function
namespace Thread {
  let hasYield = false;

  export const shareableNameMap = new WeakMap<Object, string>();

  // ShareableValues that are currently (being) claimed
  export const valueClaimMap = new Map<string, PromiseWithResolvers<void>>();
  // ShareableValues that are currently in use by
  // one of the invokations of the user defined function
  export const valueInUseCount: Record<string, number> = {};

  export function handleClaimAcceptance(
    data: ClaimAcceptanceEvent[$.EventValue]
  ) {
    const valueName = data[$.Name];
    replaceContents(globalThis[valueName], data[$.Value]);

    valueClaimMap.get(valueName)!.resolve();
  }

  export async function handleInit(data: InitEvent[$.EventValue]) {
    hasYield = data[$.HasYield];
    globalThis.pid = data[$.ProcessId];
    const variables = deserialize(data[$.Variables]);

    for (const key in variables) {
      const value = variables[key];
      if (value instanceof Object) {
        shareableNameMap.set(value, key);
        valueInUseCount[key] = 0;
      }
    }

    Object.assign(globalThis, variables);
  }

  export async function handleInvocation(
    data: InvocationEvent[$.EventValue]
  ): Promise<void> {
    const gen = globalThis[GLOBAL_FUNCTION_NAME](...data[$.Args]);

    hasYield && gen.next();
    const returnValue = await gen.next({
      $claim,
      $unclaim,
    });

    globalThis.postMessage({
      [$.EventType]: $.Return,
      [$.EventValue]: {
        [$.InvocationId]: data[$.InvocationId],
        [$.Value]: returnValue.value,
      },
    } satisfies ThreadEvent);
  }

  export async function handleSynchronization(
    data: SynchronizationEvent[$.EventValue]
  ) {
    const valueName = data[$.Name];
    replaceContents(globalThis[valueName], data[$.Value]);
  }
}
