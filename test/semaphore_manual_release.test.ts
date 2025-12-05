import { assertEquals } from "@std/assert";
import { move, Semaphore, spawn } from "../lib/lib.ts";

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
