import * as acorn from "acorn";
import * as walk from "acorn-walk";

const builtInObjects = Object.getOwnPropertyNames(globalThis);

builtInObjects.push("console");
builtInObjects.push("$claim");
builtInObjects.push("$unclaim");

export function detectUndeclaredVariables(code: string) {
  // Parse the code using Acorn
  const ast = acorn.parse(`(${code})`, { ecmaVersion: "latest" });

  // Store declared variables
  const declaredVariables = new Set<string>();

  // Walk through the AST to find declared variables
  walk.simple(ast, {
    Function(node) {
      node.params.forEach((param) => {
        // @ts-ignore Fix me later
        declaredVariables.add(param.name);
      });
    },
    VariableDeclaration(node) {
      node.declarations.forEach((declaration) => {
        // @ts-ignore Fix me later
        declaredVariables.add(declaration.id.name);
      });
    },
  });

  // Walk through the AST to find undeclared variables
  const undeclaredVariables = new Set<string>();
  walk.simple(ast, {
    Identifier(node) {
      // console.log(node);
      if (
        !declaredVariables.has(node.name) &&
        !builtInObjects.includes(node.name)
      ) {
        undeclaredVariables.add(node.name);
      }
    },
  });

  return Array.from(undeclaredVariables);
}
