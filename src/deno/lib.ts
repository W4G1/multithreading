import "./polyfill.ts";
import { workerOverride } from "../lib/pool.ts";
export * from "../lib/lib.ts";
workerOverride(() =>
  new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
);
