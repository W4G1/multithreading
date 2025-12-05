import { assertEquals } from "@std/assert";
import { move, RwLock, spawn } from "../lib/lib.ts";

Deno.test("RwLock: Concurrent Writers (Data Integrity Check)", async () => {
  // 1. Setup Shared Memory
  // We use a Uint8Array. We will increment the byte at index 0.
  const buffer = new SharedArrayBuffer(1);
  const data = new Uint8Array(buffer);
  data[0] = 0;

  const lock = new RwLock(data);

  // 2. Define Configuration
  const THREAD_COUNT = 4;
  const INCREMENTS_PER_THREAD = 50;
  // Total expected value: 200 (fits within Uint8 range of 0-255)

  // 3. Define Worker Task
  // This task acquires a Write lock, reads the value, and increments it.
  // Without a working RwLock, race conditions would cause "lost updates",
  // and the final result would be less than 200.
  const workerFn = (lock: RwLock<Uint8Array>, count: number) => {
    for (let i = 0; i < count; i++) {
      using guard = lock.writeSync();

      const current = guard.value[0]!;

      // We purposefully do a read-modify-write operation here.
      // If two threads enter this section simultaneously, they will read
      // the same 'current' value and overwrite each other's work.
      guard.value[0] = current + 1;
    }
    return true;
  };

  // 4. Spawn Workers
  const handles = [];
  for (let i = 0; i < THREAD_COUNT; i++) {
    // We pass the lock and the loop count to the worker
    handles.push(spawn(move(lock, INCREMENTS_PER_THREAD), workerFn));
  }

  // 5. Wait for all workers to finish
  const results = await Promise.all(handles.map((h) => h.join()));

  // Check for crashes
  for (const res of results) {
    if (!res.ok) throw res.error;
  }

  // 6. Assert Data Integrity
  assertEquals(
    data[0],
    THREAD_COUNT * INCREMENTS_PER_THREAD,
    `Expected value ${THREAD_COUNT * INCREMENTS_PER_THREAD}, but got ${
      data[0]
    }. Lock failed to prevent race conditions.`,
  );
});
