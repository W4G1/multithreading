import * as acorn from "acorn";
import * as walk from "acorn-walk";

function isMemoryOwnershipDeclarationUnsafe(node: any) {
  if (
    node.callee.type === "Identifier" &&
    (node.callee.name === "$claim" || node.callee.name === "$unclaim")
  ) {
    return true;
  }
  return false;
}

export function modifyFunctionString(
  fnStr: string,
  globalVars: string[]
): string {
  let compiledFnStr = fnStr;

  const ast = acorn.parse(`(${fnStr})`, { ecmaVersion: "latest" });

  let startOffset = -1;

  const scopePositions: [number, number][] = [];
  const globalVarOutOfScopePositions: Record<string, [number, number][]> =
    Object.fromEntries(globalVars.map((v) => [v, []]));

  walk.simple(ast, {
    ParenthesizedExpression(node) {
      // console.log(node);
    },
    FunctionDeclaration(node) {
      // console.log(node);
    },
    BlockStatement(node) {
      scopePositions.push([node.start, node.end]);
    },
    AssignmentExpression(node) {
      if (node.operator === "=") {
        // console.log(node);
      }
    },
    VariableDeclaration(node) {
      // console.log(node);
    },
    CallExpression(node) {
      if (isMemoryOwnershipDeclarationUnsafe(node)) {
        // Add await to the the call expression for $claim
        // if (node.callee.name === "$claim") {
        //   compiledFnStr =
        //     compiledFnStr.slice(0, node.callee.start + startOffset) +
        //     "await " +
        //     compiledFnStr.slice(node.callee.start + startOffset);

        //   startOffset += 6;
        // }

        // Replace the first argument with a string version of the argument name
        compiledFnStr =
          compiledFnStr.slice(0, node.arguments[0].start + startOffset) +
          // @ts-ignore Fix me later
          `"${node.arguments[0].name}"` +
          compiledFnStr.slice(node.arguments[0].end + startOffset);

        startOffset += 2;
      }
    },
  });

  return fnStr;
}
