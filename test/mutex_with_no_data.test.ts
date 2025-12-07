import { assertEquals } from "@std/assert";
import { move, Mutex, spawn } from "../lib/lib.ts";

Deno.test("Mutex with No Data (void)", async () => {
  // 1. Setup Empty Mutex
  const mutex = new Mutex(); // Infer <void>

  // 2. Spawn Worker
  const handle = spawn(move(mutex), (lock) => {
    using guard = lock.blockingLock();
    // Guard.value should be undefined
    return guard.value;
  });

  const result = await handle.join();
  if (!result.ok) throw result.error;

  // 3. Verification
  assertEquals(
    result.value,
    undefined,
    "Empty Mutex should have undefined value.",
  );
});
