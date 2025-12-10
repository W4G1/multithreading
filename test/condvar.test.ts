import { assertEquals } from "@std/assert";
import { Condvar, move, Mutex, spawn } from "../src/deno/lib.ts";
import { SharedJsonBuffer } from "../src/deno/lib.ts";

Deno.test("Condvar: Main thread waits for Worker notification", async () => {
  // 1. Setup Shared State
  const data = new SharedJsonBuffer({ ready: false });
  const mutex = new Mutex(data);
  const cv = new Condvar();

  // 2. Spawn Worker
  const handle = spawn(move(mutex, cv), async (m, c) => {
    // Sleep to ensure Main Thread enters the wait loop first
    await new Promise((r) => setTimeout(r, 500));

    using guard = await m.lock();
    guard.value.ready = true;
    c.notifyOne();

    return "Done";
  });

  // 3. Main Thread Logic
  {
    using guard = await mutex.lock();

    // Verify initial state
    assertEquals(guard.value.ready, false, "Should start false");

    while (!guard.value.ready) {
      await cv.wait(guard);
    }

    // Verify final state (lock is held here)
    assertEquals(guard.value.ready, true, "Should be true after wake");
  }

  // 4. Cleanup
  const result = await handle.join();
  assertEquals(result.ok, true);
});
