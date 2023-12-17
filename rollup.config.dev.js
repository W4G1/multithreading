import terser from "@rollup/plugin-terser";
import replace from "@rollup/plugin-replace";
import fs from "node:fs";
import swc from '@rollup/plugin-swc';
import inject from "@rollup/plugin-inject";
import path from "node:path";

export default ["cjs"].flatMap((type) =>
  [""].map(
    (version) =>
      /** @type {import('rollup').RollupOptions} */ ({
        input: `src/index.ts`,
        treeshake: version === ".min",
        plugins: [
          swc(),
          replace({
            __INLINE_WORKER__: fs
              .readFileSync(`.temp/worker.${type}${version}.js`, "utf8")
              .replaceAll("`", "\\`")
              .replaceAll("$", "\\$"),
          }),
          inject({
            Worker: path.resolve(`src/lib/polyfills/Worker.${type}.ts`)
          }),
        ],
        output: [
          {
            file: `dist/${type}/index${version}.js`,
            format: type,
            sourcemap: false,
            name: "multithreading",
            globals: {
              "web-worker": "Worker",
            },
            plugins: [...(version === ".min" ? [terser()] : [])],
          },
        ],
        external: ["web-worker"],
      })
  )
);
