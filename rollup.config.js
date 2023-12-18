import resolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import babel from "@rollup/plugin-babel";
import replace from "@rollup/plugin-replace";
import typescript from "@rollup/plugin-typescript";
import fs from "node:fs";

export default ["esm", "cjs"].flatMap((type) => {
  const ext = type === "esm" ? "mjs" : "cjs";
  return ["", ".min"].map(
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
        ],
        output: [
          {
            file: `dist/${type}/index${version}.${ext}`,
            format: type,
            sourcemap: false,
            name: "multithreading",
            dynamicImportInCjs: false,
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
  );
});
