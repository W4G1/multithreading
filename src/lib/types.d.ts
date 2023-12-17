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
    [$.Variables]: Record<string, any>;
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
    [$.NewValue]: any;
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

type MainEvent = InitEvent | InvocationEvent | ClaimAcceptanceEvent;
type ThreadEvent = ReturnEvent | ClaimEvent | UnclaimEvent;
