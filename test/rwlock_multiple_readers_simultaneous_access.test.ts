import { assertGreater } from "@std/assert";
import { move, RwLock, spawn } from "../src/deno/lib.ts";
import { SharedJsonBuffer } from "../src/deno/lib.ts";

Deno.test("RwLock: Multiple readers simultaneous access", async () => {
  const state = new SharedJsonBuffer({ count: 0 });
  const lock = new RwLock(state);

  // 1. Spawn 3 Readers
  // They will acquire a READ lock and hold it for 500ms.
  // If RwLock works, they will run IN PARALLEL (taking ~500ms total, not 1500ms).
  const start = performance.now();

  const readers = [];
  for (let i = 0; i < 3; i++) {
    readers.push(spawn(move(lock), async (l) => {
      // Acquire READ lock
      using guard = await l.read();

      // Hold it
      await new Promise((r) => setTimeout(r, 500));
      return guard.value.count;
    }));
  }

  await Promise.all(readers.map((h) => h.join()));
  const duration = performance.now() - start;

  // Validation:
  // 3 tasks x 500ms = 1500ms serial time.
  // If parallel, it should be close to 500ms + overhead.
  // We assert it took LESS than 1000ms to prove parallel execution.
  assertGreater(1000, duration, "Readers should run in parallel");
});
