import { assertEquals, assertNotEquals } from "@std/assert";
import { move, spawn } from "../src/deno/lib.ts";

Deno.test("Transport Hierarchy: Share > Transfer > Clone (Argument List)", async () => {
  // A. Shared Resource (SharedArrayBuffer)
  // Rule: Should remain accessible by BOTH threads simultaneously.
  const sharedView = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  );
  sharedView[0] = 100;

  // B. Transferable Resource (Standard ArrayBuffer View)
  // Rule: Underlying buffer should be MOVED. Main thread loses access (byteLength -> 0).
  const ab = new ArrayBuffer(1024);
  const transferView = new Uint8Array(ab);
  transferView[0] = 255;

  // C. Clonable Resource (Plain Object)
  // Rule: Copied. Main thread retains original, independent of Worker.
  const plainObject = { id: 1, label: "config" };

  // --- 2. EXECUTION ---

  // We pass 3 separate arguments. The non-recursive logic in shared.ts
  // should iterate this list and handle each one individually.
  const handle = spawn(
    move(sharedView, transferView, plainObject),
    (sh, tr, cl) => {
      // --- WORKER SIDE ---

      // Check 1: Shared?
      const isShared = sh.buffer instanceof SharedArrayBuffer;

      // Check 2: Transferred? (Should be valid here)
      const isTransferred = tr.byteLength === 1024;
      const contentOk = tr[0] === 255;

      // Check 3: Cloned?
      const isCloned = cl.id === 1;

      // MUTATIONS

      // A. Write to Shared (Should affect Main)
      Atomics.store(sh, 0, 999);

      // B. Write to Clone (Should NOT affect Main)
      cl.id = 500;

      return {
        isShared,
        isTransferred,
        contentOk,
        isCloned,
      };
    },
  );

  // --- 3. RESULT VERIFICATION ---
  // We check everything AFTER join to ensure postMessage has fired (pool.submit is async).

  const result = await handle.join();
  if (!result.ok) throw result.error;
  const workerData = result.value;

  // --- 4. MAIN THREAD POST-EXECUTION CHECKS ---

  // Rule: Standard ArrayBuffer must be DETACHED now.
  assertEquals(
    transferView.byteLength,
    0,
    "Standard ArrayBuffer was NOT transferred (it is still accessible).",
  );

  // Rule: SharedArrayBuffer must remain accessible
  assertNotEquals(
    sharedView.byteLength,
    0,
    "SharedArrayBuffer was detached (it should stay shared).",
  );

  // Rule: Cloned object should remain accessible and UNMODIFIED
  assertEquals(
    plainObject.id,
    1,
    "Cloned object was lost or mutated prematurely.",
  );

  // Assert Worker State
  assertEquals(
    workerData.isShared,
    true,
    "Worker did not receive SharedArrayBuffer",
  );
  assertEquals(
    workerData.isTransferred,
    true,
    "Worker did not receive Transferred Buffer",
  );
  assertEquals(workerData.contentOk, true, "Worker received corrupted data");
  assertEquals(
    workerData.isCloned,
    true,
    "Worker did not receive Cloned Object",
  );

  // Assert Synchronization (Shared)
  assertEquals(
    sharedView[0],
    999,
    "Shared Memory update from worker was not seen in Main thread.",
  );
});
