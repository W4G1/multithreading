import { assertLess } from "@std/assert";
import { move, Semaphore, spawn } from "../src/deno/lib.ts";

Deno.test("Semaphore Rate Limiting (Sync + 'using')", async () => {
  // Allow 2 threads at once.
  const sem = new Semaphore(2);
  const activeCount = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  );

  const task = (s: Semaphore, counter: Int32Array) => {
    // Blocks here if 2 people are already inside
    using _guard = s.blockingAcquire();

    // Increment "active" count
    const currentActive = Atomics.add(counter, 0, 1) + 1;

    if (currentActive > 2) {
      throw new Error(`Concurrency violation! Active count: ${currentActive}`);
    }

    // Simulate work
    const start = Date.now();
    while (Date.now() - start < 100) { /* Burn CPU */ }

    Atomics.sub(counter, 0, 1);

    return currentActive;
  }; // _guard disposed here automatically

  const h1 = spawn(move(sem, activeCount), task);
  const h2 = spawn(move(sem, activeCount), task);
  const h3 = spawn(move(sem, activeCount), task);

  const results = await Promise.all([h1.join(), h2.join(), h3.join()]);

  for (const r of results) {
    if (!r.ok) throw r.error;
    assertLess(r.value, 3, "A thread saw more than 2 active peers.");
  }
});
