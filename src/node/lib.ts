import "./polyfill.ts";
import { overrideWorkerUrl } from "../lib/pool.ts";
export * from "../lib/lib.ts";
overrideWorkerUrl(new URL("./worker.ts", import.meta.url));
