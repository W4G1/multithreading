import { build, emptyDir } from "@deno/dnt";

await emptyDir("./npm");

await build({
  entryPoints: [
    {
      name: ".",
      path: "./lib/lib.ts",
    },
    {
      name: "./_worker",
      path: "./lib/worker.ts",
    },
  ],
  outDir: "./npm",
  shims: {},
  scriptModule: false,
  test: false,
  typeCheck: false,
  compilerOptions: {
    // 2. Needed for worker types
    lib: ["ESNext", "DOM", "WebWorker"],
  },
  package: {
    name: "multithreading",
    version: Deno.args[0],
    description:
      "The missing standard threading library for Node.js, Deno and Bun. Inspired by Rust.",
    author: "Walter van der Giessen <waltervdgiessen@gmail.com>",
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
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/W4G1/multithreading.git",
    },
    bugs: {
      url: "https://github.com/W4G1/multithreading/issues",
    },
  },
  async postBuild() {
    // 3. CLEAN UP: Remove the worker from the package.json exports
    const packageJsonPath = "./npm/package.json";
    const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));

    // Delete the export entry we created above
    // Note: Depends on dnt version, it might be in "exports" or "typesVersions"
    if (packageJson.exports) {
      delete packageJson.exports["./_worker"];
    }
    if (packageJson.typesVersions && packageJson.typesVersions["*"]) {
      delete packageJson.typesVersions["*"]["_worker"];
    }

    // Write the cleaned package.json back
    await Deno.writeTextFile(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
    );

    // Copy other files
    Deno.copyFileSync("LICENSE.md", "npm/LICENSE.md");
    Deno.copyFileSync("README.md", "npm/README.md");
  },
});
