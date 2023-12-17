import * as $ from "./keys.ts";

export const serialize = (variables: Record<string, any>) => {
  const serializedVariables: Record<string, any> = {};

  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === "function") {
      serializedVariables[key] = {
        [$.WasType]: $.Function,
        value: value.toString(),
      };
    } else {
      serializedVariables[key] = value;
    }
  }

  return serializedVariables;
};

export const deserialize = (variables: Record<string, any>) => {
  const deserializedVariables: Record<string, any> = {};

  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === "object" && $.WasType in value) {
      switch (value[$.WasType]) {
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
