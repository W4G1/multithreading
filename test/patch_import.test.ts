import { assertEquals, assertNotEquals } from "@std/assert";
import { patchDynamicImports } from "../src/lib/patch_import.ts";

// Standard generic path for testing
const CALLER_PATH = "/home/user/project/src/index.ts";
// This is the normalized caller path used for relative imports
const EXPECTED_BASE_FOR_RELATIVE = "file:///home/user/project/src/index.ts";

/**
 * Helper 1: Standard Fallback Wrapper
 * Used for relative paths (./, ../) and variables.
 * Logic: new URL(ARG, new URL("file:///...", import.meta.url).href).href
 */
const wrapStandard = (argCode: string) => {
  const base = JSON.stringify(EXPECTED_BASE_FOR_RELATIVE);
  return `new URL(${argCode}, new URL(${base}, import.meta.url).href).href`;
};

/**
 * Helper 2: Root-Relative Wrapper (The Browser Fix)
 * Used for paths starting with "/".
 * Logic: new URL(ARG, (typeof location !== "undefined" ? location.origin : import.meta.url)).href
 */
const wrapRoot = (argCode: string) => {
  const base =
    `(typeof location !== "undefined" ? location.origin : import.meta.url)`;
  return `new URL(${argCode}, ${base}).href`;
};

Deno.test("Patch: Explicit relative path (double quotes)", () => {
  const input = `await import("./foo.js")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  // Should use the standard caller-relative logic
  assertEquals(result, `await import(${wrapStandard('"./foo.js"')})`);
});

Deno.test("Patch: Explicit relative path (single quotes)", () => {
  const input = `await import('./foo.js')`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrapStandard("'./foo.js'")})`);
});

Deno.test("Patch: Parent directory path", () => {
  const input = `await import("../utils/logger.ts")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrapStandard('"../utils/logger.ts"')})`);
});

Deno.test("Patch: Root Absolute path (Browser Fix)", () => {
  // Input starts with "/", so it should NOT bind to the caller path.
  // It should bind to location.origin (browser) or import.meta.url (runtime).
  const input = `await import("/opt/data/config.js")`;
  const result = patchDynamicImports(input, CALLER_PATH);

  assertEquals(result, `await import(${wrapRoot('"/opt/data/config.js"')})`);
});

Deno.test("Patch: Root Absolute path (Vite /node_modules case)", () => {
  const input = `await import("/node_modules/.deno/pkg/lib.js")`;
  const result = patchDynamicImports(input, CALLER_PATH);

  assertEquals(
    result,
    `await import(${wrapRoot('"/node_modules/.deno/pkg/lib.js"')})`,
  );
});

Deno.test("Patch: HTTP/HTTPS URLs", () => {
  const input = `await import("https://cdn.skypack.dev/multithreading")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  // HTTP urls are treated as relative paths by the logic (fallback),
  // but since new URL("http://...", base) ignores base, this works fine.
  assertEquals(
    result,
    `await import(${wrapStandard('"https://cdn.skypack.dev/multithreading"')})`,
  );
});

Deno.test("Patch: Template literals with path indicators", () => {
  // Template literals are treated as "unsafe" and fall back to standard wrapping
  const input = "await import(`./modules/${name}.js`)";
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(
    result,
    `await import(${wrapStandard("`./modules/${name}.js`")})`,
  );
});

Deno.test("Patch: Resolvable Bare Specifier (Should become Absolute URL)", () => {
  // We use "@std/assert" because we know it exists in this test environment.
  const input = `await import("@std/assert")`;
  const result = patchDynamicImports(input, CALLER_PATH);

  assertNotEquals(result, input);

  const match = result.match(/await import\((.+)\)/);
  if (!match) throw new Error("Did not match import pattern");

  const argument = match[1]!;
  const content = argument.slice(1, -1);
  // Should resolve to a fully qualified URL
  const isUrl = /^(file|https|data|node):/.test(content);

  assertEquals(isUrl, true, `Expected resolved absolute URL, got: ${content}`);
});

Deno.test("Skip: Unresolvable Bare Specifier (Should remain unchanged)", () => {
  const input = `await import("made-up-package-xyz")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, input);
});

Deno.test("Skip: Node Built-in (Often resolves to itself)", () => {
  const input = `await import("node:fs")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  const isStringOrWrapped = result.includes('"node:fs"') ||
    result.includes("'node:fs'");
  assertEquals(isStringOrWrapped, true);
});

Deno.test("Logic: Variables (Always Patched Standard)", () => {
  const input = `await import(myModulePath)`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrapStandard("myModulePath")})`);
});

Deno.test("Logic: Function calls (Always Patched Standard)", () => {
  const input = `await import(getModule("foo"))`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `await import(${wrapStandard('getModule("foo")')})`);
});

Deno.test("Whitespace: Multiline and spacing", () => {
  const input = `await import(   
    "./foo.js"  
  )`;
  const result = patchDynamicImports(input, CALLER_PATH);
  const expected = `await import(   
    ${wrapStandard('"./foo.js"')}  
  )`;
  assertEquals(result, expected);
});

Deno.test("Robustness: Escaped quotes inside strings", () => {
  const input = `import("./dir/file_\\"name\\".js")`;
  const result = patchDynamicImports(input, CALLER_PATH);
  assertEquals(result, `import(${wrapStandard('"./dir/file_\\"name\\".js"')})`);
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
      ${wrapStandard('"./real_path.js"')} // ignore "quotes" here
    )
  `;
  assertEquals(result, expected);
});

Deno.test("Logic: Two arguments (import assertions)", () => {
  const input = `import("./data.json", { assert: { type: "json" } })`;
  const result = patchDynamicImports(input, CALLER_PATH);
  const expected = `import(${
    wrapStandard('"./data.json"')
  }, { assert: { type: "json" } })`;
  assertEquals(result, expected);
});

Deno.test("Stress: Mixed Imports (Unresolvable Bare vs Relative)", () => {
  const input = `
    const _ = await import("non-existent-pkg"); 
    const local = await import("./local.js"); 
  `;
  const result = patchDynamicImports(input, CALLER_PATH);

  const expected = `
    const _ = await import("non-existent-pkg"); 
    const local = await import(${wrapStandard('"./local.js"')}); 
  `;
  assertEquals(result, expected);
});

Deno.test("Negative: Commented out imports", () => {
  // Regex does catch commented imports, so they get patched.
  // This test confirms that behavior (even if ideally they shouldn't be).
  const inputLine = `// await import("./hidden.js")`;
  const resultLine = patchDynamicImports(inputLine, CALLER_PATH);
  assertEquals(resultLine, `// await import(${wrapStandard('"./hidden.js"')})`);
});
