import { assertStrictEquals } from "@std/assert";
import { move, Semaphore, spawn } from "../lib/lib.ts";

Deno.test("Semaphore as Mutex (Async + 'using')", async () => {
  const sem = new Semaphore(1);

  // 1. Spawn T1: Holds the lock for 200ms
  const handle1 = spawn(move(sem), async (s) => {
    using _guard = await s.acquire();
    // Critical section: Hold lock long enough to be measured
    await new Promise((r) => setTimeout(r, 200));
    return "T1";
  });

  // Small delay to ensure T1 grabs the lock first
  await new Promise((r) => setTimeout(r, 50));

  // 2. Spawn T2: Tries to acquire immediately
  const handle2 = spawn(move(sem), async (s) => {
    using _guard = await s.acquire();
    return "T2";
  });

  // 3. VERIFICATION via Promise.race()
  // We race T2's completion against a timeout (100ms) that is SHORTER than T1's hold time (200ms).
  // If the mutex works, T2 MUST lose this race because it is blocked.
  const timeoutMs = 100;
  const raceResult = await Promise.race([
    handle2.join().then(() => "finished_early"), // If this wins, locking failed
    new Promise((r) => setTimeout(() => r("blocked_correctly"), timeoutMs)),
  ]);

  assertStrictEquals(
    raceResult,
    "blocked_correctly",
    "T2 finished early! It ignored the lock held by T1.",
  );

  // 4. Cleanup: Ensure both tasks complete successfully afterwards
  const [res1, res2] = await Promise.all([handle1.join(), handle2.join()]);

  if (!res1.ok || !res2.ok) throw new Error("Tasks crashed during cleanup");
});
