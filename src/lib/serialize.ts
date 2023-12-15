import { ShareableValue } from "./ShareableValue";
import { detectUndeclaredVariables } from "./detectUndeclaredVariables";

export enum VariableType {
  SharedValue,
  Function,
  Other,
}

export const WAS_KEY = "__multithreading_was__";

export const serialize = (variables: Record<string, unknown>) => {
  const serializedVariables: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(variables)) {
    if (value instanceof ShareableValue) {
      serializedVariables[key] = {
        [WAS_KEY]: VariableType.SharedValue,
        value: value.value,
      };
    } else if (typeof value === "function") {
      serializedVariables[key] = {
        [WAS_KEY]: VariableType.Function,
        value: value.toString(),
      };
    } else {
      serializedVariables[key] = value;
    }
  }

  return serializedVariables;
};

export const deserialize = (variables: Record<string, unknown>) => {
  const deserializedVariables: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === "object" && WAS_KEY in value) {
      switch (value[WAS_KEY]) {
        case VariableType.SharedValue:
          deserializedVariables[key] = new ShareableValue(value.value);
          break;

        default:
          deserializedVariables[key] = value;
          break;
      }
    } else {
      deserializedVariables[key] = value;
    }
  }

  return deserializedVariables;
};
