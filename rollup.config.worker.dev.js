import swc from "@rollup/plugin-swc";

/** @type {import('rollup').RollupOptions[]} */
export default [
  {
    input: `src/lib/worker.worker.ts`,
    plugins: [swc()],
    output: [
      {
        file: ".temp/worker.cjs.js",
        format: "cjs",
        sourcemap: false,
        dynamicImportInCjs: false,
        name: "multithreading",
      },
    ],
  },
];
