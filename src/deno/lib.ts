import "./polyfill.ts";
import { overrideGetWorker } from "../lib/pool.ts";
export * from "../lib/lib.ts";
overrideGetWorker(() =>
  new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
);
