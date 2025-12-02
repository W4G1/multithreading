import { assertEquals } from "@std/assert/equals";
import { patchDynamicImports } from "../lib/patch_import.ts";

// Standard generic path for testing
const CALLER_PATH = "/home/user/project/src/index.ts";
const EXPECTED_BASE = "file:///home/user/project/src/index.ts";

/**
 * Helper to generate the expected replaced code.
 * It simulates exactly what the patcher constructs:
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
  const input = `await import("https://cdn.skypack.dev/react")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(
    result,
    `await import(${wrap('"https://cdn.skypack.dev/react"')})`,
  );
});

Deno.test("Patch: Template literals with path indicators", () => {
  const input = "await import(`./modules/${name}.js`)";
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrap("`./modules/${name}.js`")})`);
});

Deno.test("Skip: Bare specifier (Standard Package)", () => {
  const input = `await import("lodash")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, input); // Expect NO CHANGE
});

Deno.test("Skip: Bare specifier (Scoped Package)", () => {
  const input = `await import("@std/fs")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, input); // Expect NO CHANGE
});

Deno.test("Skip: Bare specifier with subpath", () => {
  const input = `await import("react/jsx-runtime")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, input); // Expect NO CHANGE
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

Deno.test("Stress: Mixed Imports (Bare vs Relative)", () => {
  const input = `
    const _ = await import("lodash"); // Should skip
    const local = await import("./local.js"); // Should patch
  `;
  const result = patchDynamicImports(input, CALLER_PATH);

  const expected = `
    const _ = await import("lodash"); // Should skip
    const local = await import(${wrap('"./local.js"')}); // Should patch
  `;
  assertEquals(result, expected);
});

Deno.test("Negative: String containing 'import(' (False Positive)", () => {
  const input = `console.log(" import('./fake') ")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result.includes("new URL"), true);
});
