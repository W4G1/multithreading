import { assertGreater } from "@std/assert";
import { move, Semaphore, spawn } from "../lib/lib.ts";

Deno.test("Semaphore as Mutex (Async + 'using')", async () => {
  // 1. Setup
  const sem = new Semaphore(1);

  // 2. Spawn two conflicting workers
  const handle1 = spawn(move(sem), async (s) => {
    // Acquire returns a Disposable guard
    using _guard = await s.acquire();

    // Critical section
    await new Promise((r) => setTimeout(r, 1000));
    return Date.now();
  }); // _guard is disposed here automatically (release)

  // Start slightly later to ensure T1 gets the lock first
  await new Promise((r) => setTimeout(r, 500));

  const handle2 = spawn(move(sem), async (s) => {
    using _guard = await s.acquire();
    return Date.now();
  });

  const [res1, res2] = await Promise.all([handle1.join(), handle2.join()]);

  if (!res1.ok || !res2.ok) throw new Error("Tasks failed");

  // Verification: T2 must have finished AFTER T1
  assertGreater(
    res2.value,
    res1.value,
    "T2 finished before T1, meaning exclusion failed",
  );
});
