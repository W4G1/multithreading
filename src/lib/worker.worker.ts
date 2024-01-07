import "./polyfills/Promise.withResolvers.ts";
import { deserialize } from "./serialize.ts";
import * as $ from "./keys.ts";
import {
  ClaimAcceptanceEvent,
  InitEvent,
  InvocationEvent,
  MainEvent,
  SynchronizationEvent,
  ThreadEvent,
  UserFunction,
  YieldList,
} from "./types";
import { replaceContents } from "./replaceContents.ts";
import { getErrorPreview } from "./getErrorPreview.ts";
import { cyan, red, reset } from "./colors.ts";

declare global {
  var __internal: {
    [$.UserFunction]: UserFunction;
    [$.Code]: string;
  };
  function $claim(value: Object): Promise<void>;
  function $unclaim(value: Object): void;
}

// Wrap in self-invoking function to avoid polluting the global namespace
// and avoid name collisions with the user defined function
globalThis.__internal = (function () {
  const state = {
    [$.UserFunction]: function* () {} as UserFunction,
    [$.Code]: "",
  };

  let pid = -1;

  // const originalLog = console.log;
  // console.log = (...args) => {
  //   originalLog(`${cyan}[Thread_${pid}]${reset}`, ...args);
  // };
  // const originalError = console.error;
  // console.error = (...args) => {
  //   originalError(`${red}[Thread_${pid}]${reset}`, ...args);
  // };

  globalThis.$claim = async function $claim(value: Object) {
    const valueName = shareableNameMap.get(value)!;

    valueInUseCount[valueName]++;

    // First check if the variable is already (being) claimed
    if (valueClaimMap.has(valueName)) {
      return valueClaimMap.get(valueName)!.promise;
    }

    valueClaimMap.set(valueName, Promise.withResolvers<void>());

    postMessage({
      [$.EventType]: $.Claim,
      [$.EventValue]: valueName,
    } satisfies ThreadEvent);

    return valueClaimMap.get(valueName)!.promise;
  };

  globalThis.$unclaim = function $unclaim(value: Object) {
    const valueName = shareableNameMap.get(value)!;

    if (--valueInUseCount[valueName] > 0) return;

    valueClaimMap.delete(valueName);
    postMessage({
      [$.EventType]: $.Unclaim,
      [$.EventValue]: {
        [$.Name]: valueName,
        [$.Value]: value,
      },
    } satisfies ThreadEvent);
  };

  let yieldList: YieldList = [];

  const shareableNameMap = new WeakMap<Object, string>();

  // ShareableValues that are currently (being) claimed
  const valueClaimMap = new Map<string, PromiseWithResolvers<void>>();
  // ShareableValues that are currently in use by
  // one of the invokations of the user defined function
  const valueInUseCount: Record<string, number> = {};

  function handleClaimAcceptance(data: ClaimAcceptanceEvent[$.EventValue]) {
    const valueName = data[$.Name];
    replaceContents(globalThis[valueName], data[$.Value]);

    valueClaimMap.get(valueName)!.resolve();
  }

  async function handleInit(data: InitEvent[$.EventValue]) {
    pid = data[$.ProcessId];
    yieldList = data[$.YieldList];
    state[$.Code] = data[$.Code];
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

  async function handleInvocation(
    data: InvocationEvent[$.EventValue]
  ): Promise<void> {
    const gen = state[$.UserFunction](...data[$.Args]);

    let isDone = false;
    let returnValue = undefined;
    let isFirstImport = true;

    for (const yieldItem of yieldList) {
      if (yieldItem[$.Type] === "import") {
        const resolved = await import(yieldItem[$.AbsolutePath]);

        if (isFirstImport) {
          await gen.next();
          isFirstImport = false;
        }

        const result = await gen.next(resolved);

        if (result.done) {
          isDone = true;
          returnValue = result.value;
          break;
        }
      } else {
        const result = await gen.next();

        if (result.done) {
          isDone = true;
          returnValue = result.value;
          break;
        }
      }
    }

    if (!isDone) {
      const result = await gen.next();
      returnValue = result.value;
    }

    postMessage({
      [$.EventType]: $.Return,
      [$.EventValue]: {
        [$.InvocationId]: data[$.InvocationId],
        [$.Value]: returnValue,
      },
    } satisfies ThreadEvent);
  }

  async function handleSynchronization(
    data: SynchronizationEvent[$.EventValue]
  ) {
    const valueName = data[$.Name];
    replaceContents(globalThis[valueName], data[$.Value]);
  }

  // On unhandled promise rejection
  self.addEventListener("unhandledrejection", (event) => {
    event.preventDefault();

    postMessage({
      [$.EventType]: $.Error,
      [$.EventValue]: event.reason,
    } satisfies ThreadEvent);

    close();
  });

  // On uncaught exception
  self.addEventListener("error", (event) => {
    event.preventDefault();

    postMessage({
      [$.EventType]: $.Error,
      [$.EventValue]: event.error,
    } satisfies ThreadEvent);

    close();
  });

  globalThis.onmessage = async (e: MessageEvent<MainEvent>) => {
    switch (e.data[$.EventType]) {
      case $.Init:
        handleInit(e.data[$.EventValue]);
        break;
      case $.Invocation:
        handleInvocation(e.data[$.EventValue]);
        break;
      case $.ClaimAcceptance:
        handleClaimAcceptance(e.data[$.EventValue]);
        break;
      case $.Synchronization:
        handleSynchronization(e.data[$.EventValue]);
        break;
    }
  };

  return state;
})();
