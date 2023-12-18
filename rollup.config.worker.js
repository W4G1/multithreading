import resolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import babel from "@rollup/plugin-babel";

/** @type {import('rollup').RollupOptions[]} */
export default [
  {
    input: `src/lib/worker.worker.ts`,
    plugins: [
      resolve(),
      babel({
        babelHelpers: "bundled",
        include: ["src/**/*.ts"],
        extensions: [".js", ".ts"],
        exclude: ["./node_modules/**"],
        presets: ["@babel/typescript"],
      }),
    ],
    output: [
      {
        file: ".temp/worker.esm.js",
        format: "esm",
        sourcemap: false,
        name: "multithreading",
      },
      {
        file: ".temp/worker.esm.min.js",
        format: "esm",
        sourcemap: false,
        plugins: [
          terser({
            compress: {
              toplevel: true,
              passes: 3,
            },
          }),
        ],
        name: "multithreading",
      },
      {
        file: ".temp/worker.cjs.js",
        format: "cjs",
        sourcemap: false,
        dynamicImportInCjs: false,
        name: "multithreading",
      },
      {
        file: ".temp/worker.cjs.min.js",
        format: "cjs",
        sourcemap: false,
        dynamicImportInCjs: false,
        plugins: [
          terser({
            compress: {
              toplevel: true,
              passes: 3,
            },
          }),
        ],
        name: "multithreading",
      },
    ],
  },
];
