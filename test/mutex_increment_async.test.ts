import { assertEquals } from "@std/assert";
import { move, Mutex, spawn } from "../lib/lib.ts";

Deno.test("Mutex increment async", async () => {
  // 1. Setup Shared Memory
  const sab = new SharedArrayBuffer(4);
  const sharedInt = new Int32Array(sab);
  const mutex = new Mutex(sharedInt);

  // 2. Spawn Worker
  const handle1 = spawn(move(mutex), async (lock) => {
    using guard = await lock.lock();

    await new Promise((r) => setTimeout(r, 500));

    // Mutate the shared value
    guard.value[0]! += 10;
  });

  await new Promise((r) => setTimeout(r, 50));

  const handle2 = spawn(move(mutex), async (lock) => {
    using guard = await lock.lock();

    // Mutate the shared value
    guard.value[0]! += 10;
  });

  await Promise.all([handle1.join(), handle2.join()]);

  // 3. Verification
  // The update SHOULD propagate because it's backed by SharedArrayBuffer
  assertEquals(sharedInt[0], 20, "Shared memory update failed to propagate.");
});
