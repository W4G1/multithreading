import * as $ from "./keys.ts";

interface ReturnEvent {
  [$.EventType]: $.Return;
  [$.EventValue]: {
    [$.InvocationId]: data[$.InvocationId];
    [$.Value]: returnValue.value;
  };
}

interface InitEvent {
  [$.EventType]: $.Init;
  [$.EventValue]: {
    [$.ProcessId]: number;
    [$.HasYield]: boolean;
    [$.Variables]: Record<string, any>;
    [$.DebugEnabled]: boolean;
  };
}

interface ClaimEvent {
  [$.EventType]: $.Claim;
  [$.EventValue]: string;
}

interface UnclaimEvent {
  [$.EventType]: $.Unclaim;
  [$.EventValue]: {
    [$.Name]: string;
    [$.Value]: any;
  };
}

interface ClaimAcceptanceEvent {
  [$.EventType]: $.ClaimAcceptance;
  [$.EventValue]: {
    [$.Name]: valueName;
    [$.Value]: valueName;
  };
}

interface InvocationEvent {
  [$.EventType]: $.Invocation;
  [$.EventValue]: {
    [$.InvocationId]: number;
    [$.Args]: any[];
  };
}

interface SynchronizationEvent {
  [$.EventType]: $.Synchronization;
  [$.EventValue]: {
    [$.Name]: string;
    [$.Value]: any;
  };
}

type MainEvent =
  | InitEvent
  | InvocationEvent
  | ClaimAcceptanceEvent
  | SynchronizationEvent;
type ThreadEvent = ReturnEvent | ClaimEvent | UnclaimEvent;
