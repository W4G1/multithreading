import * as $ from "./keys.ts";

type ImportYield = {
  [$.Type]: "import";
  [$.Name]: string;
  [$.AbsolutePath]: string;
};
type VariableYield = {
  [$.Type]: "variable";
  [$.Name]: string;
};

type YieldList = (ImportYield | VariableYield)[];

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
    [$.YieldList]: YieldList;
    [$.Variables]: Record<string, any>;
    [$.Code]: string;
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
