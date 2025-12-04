import { assertEquals, assertGreater, assertLess } from "@std/assert";
import { move, Semaphore, spawn } from "../lib/lib.ts";

Deno.test("Semaphore as Mutex (Async + 'using')", async () => {
  // 1. Setup
  const sem = new Semaphore(1);

  // 2. Spawn two conflicting workers
  const handle1 = spawn(move(sem), async (s) => {
    // Acquire returns a Disposable guard
    using _guard = await s.acquire();

    // Critical section
    await new Promise((r) => setTimeout(r, 200));
    return Date.now();
  }); // _guard is disposed here automatically (release)

  // Start slightly later to ensure T1 gets the lock first
  await new Promise((r) => setTimeout(r, 50));

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

Deno.test("Semaphore Rate Limiting (Sync + 'using')", async () => {
  // Allow 2 threads at once.
  const sem = new Semaphore(2);
  const sab = new SharedArrayBuffer(4);
  const activeCount = new Int32Array(sab);

  const task = async (s: Semaphore, counter: Int32Array) => {
    // Blocks here if 2 people are already inside
    using _guard = s.acquireSync();

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

Deno.test("Semaphore Multi-Permit (Batch 'using')", async () => {
  const sem = new Semaphore(5);

  const handle = spawn(move(sem), (s) => {
    {
      // Grab all 5 permits
      using _guard = s.acquireSync(5);
      if (s.tryAcquire(1) !== null) {
        throw new Error("Should have exhausted permits");
      }
    } // Released 5 here

    // Should be free again
    using _guard2 = s.acquireSync(5);
    return true;
  });

  const result = await handle.join();
  assertEquals(result.ok, true);
});

Deno.test("Semaphore tryAcquire (Conditional 'using')", async () => {
  const sem = new Semaphore(1);

  const handle = spawn(move(sem), (s) => {
    // 1. Successful Try
    const guard = s.tryAcquire();
    if (!guard) throw new Error("Failed to acquire free semaphore");

    {
      using _g = guard;
      // 2. Failed Try (inside lock)
      if (s.tryAcquire() !== null) {
        throw new Error("Double acquire should fail");
      }
    } // Released here

    // 3. Successful Try (after scope)
    if (!s.tryAcquire()) throw new Error("Should be free again");

    return true;
  });

  const result = await handle.join();
  if (!result.ok) throw result.error;
  assertEquals(result.ok, true);
});

Deno.test("Semaphore Manual Release (Bypassing 'using')", async () => {
  const sem = new Semaphore(1);

  const handle = spawn(move(sem), async (s) => {
    const { drop } = await import("../lib/lib.ts");
    // Test A: Manual Dispose on the Guard
    const guard = await s.acquire();
    // ... work ...
    drop(guard); // Manual call

    // Check if free
    if (!s.tryAcquire(1)) throw new Error("Manual dispose failed");
    s.release(1); // Clean up the tryAcquire check

    // Test B: Raw release (ignoring the guard)
    // This simulates a scenario where you might want to release
    // without having the guard object handy, or bridging legacy code.
    await s.acquire();
    // We intentionally drop the return value (the guard).
    // JS Garbage Collection does NOT trigger dispose, so the lock is held.

    // We manually release on the semaphore instance
    s.release(1);

    // Verify we are back to neutral
    if (!s.tryAcquire(1)) throw new Error("Raw release failed");

    return true;
  });

  const result = await handle.join();
  if (!result.ok) throw result.error;
  assertEquals(result.ok, true);
});
