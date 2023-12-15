import typescript from "@rollup/plugin-typescript";
import resolve from '@rollup/plugin-node-resolve';
import terser from "@rollup/plugin-terser";
import babel from '@rollup/plugin-babel';

const extensions = ['.js', '.ts' ];

/** @type {import('rollup').RollupOptions[]} */
export default [
  {
    input: `src/lib/worker.worker.ts`,
    plugins: [
      typescript({
        alwaysStrict: true,
        compilerOptions: {
          declaration: false,
          declarationMap: false,
        }
      }),
      resolve(),
      babel({ babelHelpers: 'bundled', include: ['src/**/*.ts'], extensions, exclude: ['./node_modules/**'] }),
    ],
    output: [
      {
        file: ".temp/worker.esm.js",
        format: "esm",
        sourcemap: true,
        name: "multithreading",
      },
      {
        file: ".temp/worker.esm.min.js",
        format: "esm",
        sourcemap: true,
        plugins: [terser()],
        name: "multithreading",
      },
      {
        file: ".temp/worker.cjs.js",
        format: "cjs",
        sourcemap: true,
        name: "multithreading",
      },
      {
        file: ".temp/worker.cjs.min.js",
        format: "cjs",
        sourcemap: true,
        plugins: [terser()],
        name: "multithreading",
      },
    ],
  },
];
