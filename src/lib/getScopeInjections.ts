import { detectUndeclaredVariables } from "./detectUndeclaredVariables";

export function getScopeInjections(
  scope: typeof eval,
  undeclaredVariables: string[]
) {
  const scopeInjections: string[] = [];

  for (const variable of undeclaredVariables) {
    let value;
    try {
      value = scope(variable);
    } catch (_error) {
      throw new ReferenceError(
        `${variable} is not defined in the function scope`
      );
    }

    // console.log(variable, value);

    if (typeof value === "function") {
      // Check if function has any undeclared variables
      const subFnStr = value.toString();
      const undeclaredVariables = detectUndeclaredVariables(subFnStr);

      if (undeclaredVariables.length !== 0) {
        throw new Error(
          `Nested function ${variable} has undeclared variables: ${undeclaredVariables.join(
            ", "
          )}`
        );
      }

      scopeInjections.push(subFnStr);
    } else if (typeof value === "number") {
      scopeInjections.push(`let ${variable} = ${value}`);
    } else if (typeof value === "string") {
      scopeInjections.push(`let ${variable} = "${value}"`);
    }
  }

  return scopeInjections;
}
