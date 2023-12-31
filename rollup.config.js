import resolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import babel from "@rollup/plugin-babel";
import replace from "@rollup/plugin-replace";
import swc from "@rollup/plugin-swc";
import fs from "node:fs";
import ts from "rollup-plugin-ts";

const bundleResolve = {
  esm: "import.meta.resolve",
  cjs: "require.resolve",
};

export default ["esm", "cjs"].flatMap((type) => {
  const ext = type === "esm" ? "mjs" : "js";
  return ["", ".min"].map(
    (version) =>
      /** @type {import('rollup').RollupOptions} */ ({
        input: `src/index.ts`,
        treeshake: version === ".min",
        plugins: [
          ...(type === "cjs" && version === ""
            ? [
                ts({
                  browserslist: false,
                  transpileOnly: true,
                }),
              ]
            : []),
          swc(),
          resolve(),
          babel({
            babelHelpers: "bundled",
            include: ["src/**/*.ts"],
            extensions: [".js", ".ts"],
            exclude: ["./node_modules/**"],
          }),
          replace({
            __INLINE_WORKER__: fs
              .readFileSync(`.temp/worker.${type}${version}.js`, "utf8")
              .replaceAll("\\", "\\\\")
              .replaceAll("`", "\\`")
              .replaceAll("$", "\\$"),
          }),
          {
            resolveImportMeta(prop, { format }) {
              if (prop === "resolve") {
                return bundleResolve[format];
              }
            },
          },
        ],

        output: [
          {
            file: `dist/index${version}.${ext}`,
            format: type,
            sourcemap: false,
            name: "multithreading",
            dynamicImportInCjs: true,
            globals: {
              "web-worker": "Worker",
            },
            plugins: [
              ...(version === ".min"
                ? [
                    terser({
                      compress: {
                        toplevel: true,
                        passes: 2,
                      },
                      mangle: {},
                    }),
                  ]
                : []),
            ],
          },
        ],
      })
  );
});
