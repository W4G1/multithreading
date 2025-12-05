import { assertEquals } from "@std/assert";
import { move, Mutex, spawn } from "../lib/lib.ts";

Deno.test("Mutex with Transferable Data (Standard Int32Array)", async () => {
  // 1. Setup Standard Memory (Not Shared)
  const buffer = new ArrayBuffer(4);
  const transferInt = new Int32Array(buffer);
  transferInt[0] = 123;

  const mutex = new Mutex(transferInt);

  // 2. Spawn Worker
  const handle = spawn(move(mutex), (lock) => {
    using guard = lock.acquireSync();

    const val = guard.value[0];
    // Mutate the local (transferred) copy
    guard.value[0] = 456;

    return val;
  });

  const result = await handle.join();
  if (!result.ok) throw result.error;

  // 3. Immediate Verification in Main Thread
  // Because it was backed by a standard ArrayBuffer, it should have been TRANSFERRED.
  // This means the Main Thread view is now detached (length 0).
  assertEquals(
    transferInt.byteLength,
    0,
    "Standard TypedArray should be detached (transferred) from Main thread.",
  );

  // 4. Verification
  assertEquals(
    result.value,
    123,
    "Worker should have received the original value.",
  );
});
