import { workerOverride } from "../lib/pool.ts";
export * from "../lib/lib.ts";
workerOverride(() =>
  new Worker(new URL("../lib/worker.ts", import.meta.url), { type: "module" })
);
