import ts from "typescript";
import { ensureDir, expandGlob } from "@std/fs";
import * as path from "@std/path";

const OUT_DIR = "./dist";
const VERSION = Deno.args[0] || "0.0.1";

console.log(`[Build] Cleaning ${OUT_DIR}...`);
try {
  await Deno.remove(OUT_DIR, { recursive: true });
} catch {
  // Ignore if dir doesn't exist
}
await ensureDir(OUT_DIR);

/**
 * Helper to rewrite .ts imports to .js imports inside transpiled code
 * AND rewrite new URL("./worker.ts") to new URL("./worker.js")
 */
const transformer: ts.TransformerFactory<ts.SourceFile> = (
  context,
) => {
  const visitor: ts.Visitor = (node) => {
    // 1. Handle Static Imports/Exports (import ... from "./x.ts")
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const text = node.moduleSpecifier.text;
        if (text.endsWith(".ts")) {
          const newSpecifier = ts.factory.createStringLiteral(
            text.replace(/\.ts$/, ".js"),
          );

          if (ts.isImportDeclaration(node)) {
            return ts.factory.updateImportDeclaration(
              node,
              node.modifiers,
              node.importClause,
              newSpecifier,
              node.attributes,
            );
          } else {
            return ts.factory.updateExportDeclaration(
              node,
              node.modifiers,
              node.isTypeOnly,
              node.exportClause,
              newSpecifier,
              node.attributes,
            );
          }
        }
      }
    }

    // 2. Handle Dynamic Worker URL (new URL("./worker.ts", ...))
    if (ts.isNewExpression(node)) {
      // Check if the expression being new'ed is "URL"
      if (ts.isIdentifier(node.expression) && node.expression.text === "URL") {
        if (node.arguments && node.arguments.length > 0) {
          const firstArg = node.arguments[0]!;

          // Check if first arg is a string literal ending in .ts
          if (ts.isStringLiteral(firstArg) && firstArg.text.endsWith(".ts")) {
            console.log(
              `[Transform] Rewriting new URL("${firstArg.text}") -> .js`,
            );

            const newArg = ts.factory.createStringLiteral(
              firstArg.text.replace(/\.ts$/, ".js"),
            );

            // Create a new arguments array, preserving the second argument (import.meta.url)
            const newArguments = [newArg, ...node.arguments.slice(1)];

            return ts.factory.updateNewExpression(
              node,
              node.expression,
              node.typeArguments,
              newArguments,
            );
          }
        }
      }
    }

    return ts.visitEachChild(node, visitor, context);
  };

  return (sourceFile) => ts.visitNode(sourceFile, visitor) as ts.SourceFile;
};

console.log("[Build] Discovering source files...");

const entryPoints: string[] = [];

// Recursively find all .ts files in ./src
for await (const file of expandGlob("./src/**/*.ts")) {
  // We typically exclude .d.ts files from being entry points
  // (unless you specifically need to process them)
  if (!file.path.endsWith(".d.ts")) {
    entryPoints.push(file.path);
  }
}

console.log(`[Build] Found ${entryPoints.length} files to compile.`);

console.log("[Build] Compiling TypeScript...");

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  declaration: true,
  outDir: OUT_DIR,
  rootDir: ".",
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.webworker.d.ts"],
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  stripInternal: true,
};

const host = ts.createCompilerHost(compilerOptions);
const program = ts.createProgram(entryPoints, compilerOptions, host);

const emitResult = program.emit(undefined, undefined, undefined, undefined, {
  after: [transformer],
  afterDeclarations: [transformer],
});

const allDiagnostics = ts
  .getPreEmitDiagnostics(program)
  .concat(emitResult.diagnostics);

allDiagnostics.forEach((diagnostic) => {
  if (diagnostic.file) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
      diagnostic.start!,
    );
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      "\n",
    );
    console.error(
      `${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`,
    );
  } else {
    console.error(
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    );
  }
});

if (emitResult.emitSkipped) {
  console.error("[Build] Compilation failed.");
  Deno.exit(1);
}

console.log("[Build] Generating package.json...");

const packageJson = {
  name: "multithreading",
  version: VERSION,
  description:
    "The missing standard library for multithreading in JavaScript (Works in the browser, Node.js, Deno, Bun).",
  keywords: [
    "multithreading",
    "multi-threading",
    "threads",
    "threading",
    "webworkers",
    "web-workers",
    "worker-threads",
    "sharedarraybuffer",
    "shared-array-buffer",
    "worker-pool",
    "thread-pool",
    "concurrency",
    "atomics",
    "deno",
    "bun",
  ],
  author: "Walter van der Giessen <waltervdgiessen@gmail.com>",
  repository: {
    type: "git",
    url: "git+https://github.com/W4G1/multithreading.git",
  },
  license: "MIT",
  bugs: {
    url: "https://github.com/W4G1/multithreading/issues",
  },
  type: "module",
  exports: {
    ".": {
      "types": "./src/default/lib.d.ts",
      "bun": "./src/default/lib.js",
      "deno": "./src/deno/lib.js",
      "browser": "./src/browser/lib.js",
      "node": "./src/node/lib.js",
      "default": "./src/default/lib.js",
    },
  },
  scripts: {},
};

await Deno.writeTextFile(
  path.join(OUT_DIR, "package.json"),
  JSON.stringify(packageJson, null, 2),
);

// Copy assets
try {
  await Deno.copyFile("LICENSE.md", path.join(OUT_DIR, "LICENSE.md"));
  await Deno.copyFile("README.md", path.join(OUT_DIR, "README.md"));
} catch (e) {
  console.error(e);
}

console.log("[Build] Success!");
