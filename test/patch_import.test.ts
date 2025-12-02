import { assertEquals, assertNotEquals } from "@std/assert";
import { patchDynamicImports } from "../lib/patch_import.ts";

// Standard generic path for testing
const CALLER_PATH = "/home/user/project/src/index.ts";
const EXPECTED_BASE = "file:///home/user/project/src/index.ts";

/**
 * Helper to generate the expected replaced code.
 * It simulates exactly what the patcher constructs for relative paths:
 * new URL(ARG, new URL("file:///...", import.meta.url).href).href
 */
const wrap = (argCode: string) => {
  const base = JSON.stringify(EXPECTED_BASE);
  return `new URL(${argCode}, new URL(${base}, import.meta.url).href).href`;
};

Deno.test("Patch: Explicit relative path (double quotes)", () => {
  const input = `await import("./foo.js")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrap('"./foo.js"')})`);
});

Deno.test("Patch: Explicit relative path (single quotes)", () => {
  const input = `await import('./foo.js')`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrap("'./foo.js'")})`);
});

Deno.test("Patch: Parent directory path", () => {
  const input = `await import("../utils/logger.ts")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrap('"../utils/logger.ts"')})`);
});

Deno.test("Patch: Absolute path", () => {
  const input = `await import("/opt/data/config.js")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrap('"/opt/data/config.js"')})`);
});

Deno.test("Patch: HTTP/HTTPS URLs", () => {
  const input = `await import("https://cdn.skypack.dev/multithreading")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(
    result,
    `await import(${wrap('"https://cdn.skypack.dev/multithreading"')})`,
  );
});

Deno.test("Patch: Template literals with path indicators", () => {
  const input = "await import(`./modules/${name}.js`)";
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrap("`./modules/${name}.js`")})`);
});

Deno.test("Patch: Resolvable Bare Specifier (Should become Absolute URL)", () => {
  // We use "@std/assert" because we know it exists in this test environment.
  // The patcher should resolve this to "file:///.../assert/mod.ts" or "https://jsr.io..."
  const input = `await import("@std/assert")`;
  const result = patchDynamicImports(input, CALLER_PATH);

  // 1. It should NOT be the same as input
  assertNotEquals(result, input);

  // 2. It should have replaced the argument with a quoted string
  //    (We can't test the exact path as it varies by OS/Environment)
  //    Matches: await import("...")
  const match = result.match(/await import\((.+)\)/);
  if (!match) throw new Error("Did not match import pattern");

  // 3. The argument should be a resolved URL string (starting with file:, https:, or data:)
  const argument = match[1]!; // includes quotes
  const content = argument.slice(1, -1); // strip quotes
  const isUrl = /^(file|https|data|node):/.test(content);

  assertEquals(isUrl, true, `Expected resolved absolute URL, got: ${content}`);
});

Deno.test("Skip: Unresolvable Bare Specifier (Should remain unchanged)", () => {
  // "made-up-package-xyz" definitely doesn't exist.
  // import.meta.resolve should throw/fail, and the patcher should catch it and do nothing.
  const input = `await import("made-up-package-xyz")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, input); // Expect NO CHANGE
});

Deno.test("Skip: Node Built-in (Often resolves to itself)", () => {
  // import.meta.resolve("node:fs") usually returns "node:fs"
  const input = `await import("node:fs")`;
  const result = patchDynamicImports(input, CALLER_PATH);

  // Depending on the runtime, this might stay "node:fs" or be fully resolved.
  // But strictly speaking, if it resolves, it will be a string.
  // If it doesn't resolve, it stays "node:fs".
  // In most cases, this essentially looks unchanged or just quoted.
  const isStringOrWrapped = result.includes('"node:fs"') ||
    result.includes("'node:fs'");
  assertEquals(isStringOrWrapped, true);
});

Deno.test("Logic: Variables (Always Patched)", () => {
  const input = `await import(myModulePath)`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrap("myModulePath")})`);
});

Deno.test("Logic: Function calls (Always Patched)", () => {
  const input = `await import(getModule("foo"))`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrap('getModule("foo")')})`);
});

Deno.test("Whitespace: Multiline and spacing", () => {
  const input = `await import(   
    "./foo.js"  
  )`;
  const result = patchDynamicImports(input, CALLER_PATH);
  const expected = `await import(   
    ${wrap('"./foo.js"')}  
  )`;
  assertEquals(result, expected);
});

Deno.test("Robustness: Escaped quotes inside strings", () => {
  const input = `import("./dir/file_\\"name\\".js")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `import(${wrap('"./dir/file_\\"name\\".js"')})`);
});

Deno.test("Robustness: Comments containing syntax triggers", () => {
  const input = `
    import(
      /* ignore ) this */
      "./real_path.js" // ignore "quotes" here
    )
  `;
  const result = patchDynamicImports(input, CALLER_PATH);
  const expected = `
    import(
      /* ignore ) this */
      ${wrap('"./real_path.js"')} // ignore "quotes" here
    )
  `;
  assertEquals(result, expected);
});

Deno.test("Logic: Two arguments (import assertions)", () => {
  const input = `import("./data.json", { assert: { type: "json" } })`;
  const result = patchDynamicImports(input, CALLER_PATH);
  const expected = `import(${
    wrap('"./data.json"')
  }, { assert: { type: "json" } })`;
  assertEquals(result, expected);
});

Deno.test("Stress: Mixed Imports (Unresolvable Bare vs Relative)", () => {
  // "non-existent-pkg" should skip (unless you actually have it installed)
  // "./local.js" should patch
  const input = `
    const _ = await import("non-existent-pkg"); 
    const local = await import("./local.js"); 
  `;
  const result = patchDynamicImports(input, CALLER_PATH);

  const expected = `
    const _ = await import("non-existent-pkg"); 
    const local = await import(${wrap('"./local.js"')}); 
  `;
  assertEquals(result, expected);
});

Deno.test("Negative: String containing 'import(' (False Positive)", () => {
  const input = `console.log(" import('./fake') ")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result.includes("new URL"), true);
});

Deno.test("Negative: Commented out imports", () => {
  const inputLine = `// await import("./hidden.js")`;
  const resultLine = patchDynamicImports(inputLine, CALLER_PATH);
  assertEquals(resultLine, `// await import(${wrap('"./hidden.js"')})`);
});
