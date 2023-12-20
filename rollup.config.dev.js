import terser from "@rollup/plugin-terser";
import replace from "@rollup/plugin-replace";
import fs from "node:fs";
import swc from "@rollup/plugin-swc";

export default ["cjs"].flatMap((type) => {
  const ext = type === "esm" ? "mjs" : "js";
  return [""].map(
    (version) =>
      /** @type {import('rollup').RollupOptions} */ ({
        input: `src/index.ts`,
        treeshake: version === ".min",
        plugins: [
          swc(),
          replace({
            __INLINE_WORKER__: fs
              .readFileSync(`.temp/worker.${type}${version}.js`, "utf8")
              .replaceAll("\\", "\\\\")
              .replaceAll("`", "\\`")
              .replaceAll("$", "\\$"),
          }),
        ],
        output: [
          {
            file: `dist/index.${ext}`,
            format: type,
            sourcemap: false,
            name: "multithreading",
            dynamicImportInCjs: false,
            globals: {
              "web-worker": "Worker",
            },
            plugins: [...(version === ".min" ? [terser()] : [])],
          },
        ],
        external: ["web-worker"],
      })
  );
});
