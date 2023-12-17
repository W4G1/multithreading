import resolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import babel from "@rollup/plugin-babel";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import inject from "@rollup/plugin-inject";
import fs from "node:fs";
import path from "node:path";

export default ["esm", "cjs"].flatMap((type) =>
  ["", ".min"].map(
    (version) =>
      /** @type {import('rollup').RollupOptions} */ ({
        input: `src/index.ts`,
        treeshake: version === ".min",
        plugins: [
          resolve(),
          babel({
            babelHelpers: "bundled",
            include: ["src/**/*.ts"],
            extensions: [".js", ".ts"],
            exclude: ["./node_modules/**"],
          }),
          typescript(),
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
            plugins: [
              ...(version === ".min"
                ? [
                    terser({
                      compress: {
                        toplevel: true,
                        passes: 3,
                      },
                    }),
                  ]
                : []),
            ],
          },
        ],
        external: ["web-worker"],
      })
  )
);
