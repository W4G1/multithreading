import ts from "typescript";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/ensure_dir.ts";
import * as path from "https://deno.land/std@0.224.0/path/mod.ts";
import { existsSync } from "https://deno.land/std@0.224.0/fs/exists.ts";

const OUT_DIR = "./npm";
const VERSION = Deno.args[0] || "0.0.1";

console.log(`[Build] Cleaning ${OUT_DIR}...`);
await Deno.remove(OUT_DIR, { recursive: true }).catch(() => {});
await ensureDir(OUT_DIR);

/**
 * Helper to rewrite .ts imports to .js imports inside transpiled code
 */
const rewriteImportsVisitor =
  (context: ts.TransformationContext) => (node: ts.Node): ts.Node => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const originalPath = node.moduleSpecifier.text;
        if (originalPath.endsWith(".ts")) {
          return (
            ts.isImportDeclaration(node)
              ? ts.factory.updateImportDeclaration
              : ts.factory.updateExportDeclaration
          )(
            // @ts-ignore: Dynamic dispatch for update method
            node,
            node.modifiers,
            node.isTypeOnly ? node.isTypeOnly : node.importClause, // Handle difference in args
            node.isTypeOnly ? node.exportClause : undefined, // Handle difference in args
            ts.factory.createStringLiteral(
              originalPath.replace(/\.ts$/, ".js"),
            ),
            node.attributes,
          );
        }
      }
    }
    return ts.visitEachChild(node, rewriteImportsVisitor(context), context);
  };

const importTransformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
  return (sourceFile) => {
    const visitor: ts.Visitor = (node) => {
      // Import/Export Rewriting (.ts -> .js)
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

      return ts.visitEachChild(node, visitor, context);
    };

    return ts.visitNode(sourceFile, visitor) as ts.SourceFile;
  };
};

console.log("[Build] Compiling TypeScript...");

const entryPoints = ["./lib/lib.ts", "./lib/worker.ts"];

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  declaration: true,
  outDir: OUT_DIR,
  rootDir: ".",
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.webworker.d.ts"],
  skipLibCheck: true,
  allowImportingTsExtensions: true,
};

const host = ts.createCompilerHost(compilerOptions);
const program = ts.createProgram(entryPoints, compilerOptions, host);

const emitResult = program.emit(undefined, undefined, undefined, undefined, {
  after: [importTransformer],
  afterDeclarations: [importTransformer],
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
    "The missing standard threading library for Node.js, Deno and Bun. Inspired by Rust.",
  keywords: [
    "multithreading",
    "threads",
    "webworkers",
    "parallel",
    "concurrent",
    "concurrency",
    "web-workers",
    "worker-threads",
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
  module: "./esm/lib.js",
  exports: {
    ".": {
      import: "./lib/lib.js",
      types: "./lib/lib.d.ts",
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
} catch (e) {}

console.log("[Build] Success!");
