import { assertEquals, assertNotEquals } from "@std/assert";
import { move, spawn } from "../src/deno/lib.ts";

Deno.test("Nested Uint8Array should be CLONED (Fallback Safety)", async () => {
  // 1. Setup Data
  // We use a reasonably sized buffer so we can verify content
  const originalBuffer = new Uint8Array(1024);
  originalBuffer[0] = 123;
  originalBuffer[1023] = 42;

  // 2. Nest it inside a plain object
  // Since our logic only scans top-level args, this should NOT be transferred.
  const payload = {
    name: "nested-test",
    data: originalBuffer,
  };

  // 3. Spawn Worker
  const handle = spawn(move(payload), (obj) => {
    // --- WORKER SIDE ---
    const buf = obj.data;

    // Check Content
    const contentOk = buf[0] === 123 && buf[1023] === 42;

    // Modify Worker Copy
    // If it was Cloned, this will NOT affect the Main thread
    buf[0] = 255;

    return {
      contentOk,
      workerValue: buf[0],
    };
  });

  // 4. Wait for completion (ensures postMessage has fired)
  const result = await handle.join();
  if (!result.ok) throw result.error;

  // 5. Verification

  // Rule: Buffer must NOT be detached (ByteLength > 0)
  // If it was Transferred, length would be 0.
  // Since it is Nested + Non-Recursive Scanner, it must be Cloned.
  assertNotEquals(
    originalBuffer.byteLength,
    0,
    "Buffer was Transferred! It should have been Cloned because it was nested.",
  );

  // Rule: Content must be preserved in Main thread
  // Since it was Cloned, Main thread holds a separate copy.
  // Worker modification (255) should NOT be visible here.
  assertEquals(
    originalBuffer[0],
    123,
    "Buffer was Shared! Modification in worker affected Main thread.",
  );

  // Rule: Worker received correct data
  assertEquals(result.value.contentOk, true, "Worker received corrupted data.");
  assertEquals(
    result.value.workerValue,
    255,
    "Worker did not modify its own copy.",
  );
});
