import { assertEquals } from "@std/assert";
import { move, Mutex, spawn } from "../src/deno/lib.ts";

Deno.test("Mutex with Shared Memory (Int32Array)", async () => {
  // 1. Setup Shared Memory
  const sab = new SharedArrayBuffer(4);
  const sharedInt = new Int32Array(sab);
  const mutex = new Mutex(sharedInt);

  // 2. Spawn Worker
  const handle = spawn(move(mutex), (lock) => {
    using guard = lock.blockingLock();
    // Mutate the shared value
    guard.value[0] = 42;
    return guard.value[0];
  });

  await handle.join();

  // 3. Verification
  // The update SHOULD propagate because it's backed by SharedArrayBuffer
  assertEquals(sharedInt[0], 42, "Shared memory update failed to propagate.");
});
