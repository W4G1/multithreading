import typescript from "@rollup/plugin-typescript";
import resolve from '@rollup/plugin-node-resolve';
import terser from "@rollup/plugin-terser";
import babel from '@rollup/plugin-babel';
import replace from '@rollup/plugin-replace';
import fs from 'node:fs';

const extensions = ['.js', '.ts' ];

/** @type {import('rollup').RollupOptions[]} */
export default [
  {
    input: `src/index.ts`,
    plugins: [
      typescript({
        alwaysStrict: true,
      }),
      resolve(),
      babel({ babelHelpers: 'bundled', include: ['src/**/*.ts'], extensions, exclude: ['./node_modules/**'] }),
    ],
    output: [
      {
        file: "dist/bundle.esm.js",
        format: "esm",
        sourcemap: true,
        name: "multithreading",
        globals: {
          "web-worker": "Worker"
        },
        plugins: [
          replace({
            '__INLINE_WORKER__': fs.readFileSync('.temp/worker.esm.js', 'utf8').replaceAll("`", "\\`").replaceAll("$", "\\$"),
          })
        ]
      },
      {
        file: "dist/bundle.esm.min.js",
        format: "esm",
        sourcemap: true,
        name: "multithreading",
        globals: {
          "web-worker": "Worker"
        },
        plugins: [
          replace({
            '__INLINE_WORKER__': fs.readFileSync('.temp/worker.esm.min.js', 'utf8').replaceAll("`", "\\`").replaceAll("$", "\\$")
          }),
          terser()
        ]
      },
      {
        file: "dist/bundle.cjs.js",
        format: "cjs",
        sourcemap: true,
        name: "multithreading",
        globals: {
          "web-worker": "Worker"
        },
        plugins: [
          replace({
            '__INLINE_WORKER__': fs.readFileSync('.temp/worker.cjs.js', 'utf8').replaceAll("`", "\\`").replaceAll("$", "\\$"),
          })
        ]
      },
      {
        file: "dist/bundle.cjs.min.js",
        format: "cjs",
        sourcemap: true,
        name: "multithreading",
        globals: {
          "web-worker": "Worker"
        },
        plugins: [
          replace({
            '__INLINE_WORKER__': fs.readFileSync('.temp/worker.cjs.min.js', 'utf8').replaceAll("`", "\\`").replaceAll("$", "\\$"),
          }),
          terser()
        ]
      },
    ],
    external: ["web-worker"],
  },
];
