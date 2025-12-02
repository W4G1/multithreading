import { assertEquals } from "@std/assert/equals";
import { drop, initRuntime, move, RwLock, spawn } from "../lib/lib.ts";
import { assertGreater } from "@std/assert/greater";
import { SharedJsonBuffer } from "../lib/json_buffer.ts";

// Initialize the runtime.
// We wrap in try/catch because Deno test runners might re-execute this context
// or run in parallel, and initRuntime throws if called twice.
try {
  initRuntime({ maxWorkers: 4 });
} catch {
  // Runtime already initialized
}

Deno.test("RwLock: Main thread async Read/Write usage", async () => {
  // 1. Setup Shared Memory
  const buffer = new SharedArrayBuffer(1);
  const data = new Uint8Array(buffer);
  const lock = new RwLock(data);

  // 2. Main thread Write
  {
    using guard = await lock.write();
    guard.value[0] = 42;
    assertEquals(guard.value[0], 42);
  } // Guard disposed, lock released

  // 3. Main thread Read
  {
    using guard = await lock.read();
    assertEquals(guard.value[0], 42);
  } // Guard disposed, lock released
});

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

Deno.test("RwLock: Readers do not block Readers", async () => {
  // This test ensures that multiple readers can access data concurrently.
  // While we can't easily assert "exact simultaneity" in a unit test without timing flake,
  // we can ensure that multiple readers complete successfully and see the correct data.

  const buffer = new SharedArrayBuffer(1);
  const data = new Uint8Array(buffer);
  data[0] = 128; // specific value to check
  const lock = new RwLock(data);

  const readerFn = (lock: RwLock<Uint8Array>) => {
    // Acquire read lock multiple times
    for (let i = 0; i < 10; i++) {
      using guard = lock.readSync();
      if (guard.value[0] !== 128) {
        throw new Error("Data corruption detected during read");
      }
    }
    return true;
  };

  const handles = [
    spawn(move(lock), readerFn),
    spawn(move(lock), readerFn),
    spawn(move(lock), readerFn),
  ];

  const results = await Promise.all(handles.map((h) => h.join()));

  for (const res of results) {
    if (!res.ok) throw res.error;
  }

  assertEquals(data[0], 128);
});

Deno.test({
  name: "RwLock: Multiple readers simultaneous access",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const state = new SharedJsonBuffer({ count: 0 });
    const lock = new RwLock(state);

    // 1. Spawn 3 Readers
    // They will acquire a READ lock and hold it for 500ms.
    // If RwLock works, they will run IN PARALLEL (taking ~500ms total, not 1500ms).
    const start = performance.now();

    const readers = [];
    for (let i = 0; i < 3; i++) {
      readers.push(spawn(move(lock), async (l) => {
        // Acquire READ lock
        using guard = await l.read();

        // Hold it
        await new Promise((r) => setTimeout(r, 500));
        return guard.value.count;
      }));
    }

    await Promise.all(readers.map((h) => h.join()));
    const duration = performance.now() - start;

    console.log(`Readers finished in ${duration.toFixed(0)}ms`);

    // Validation:
    // 3 tasks x 500ms = 1500ms serial time.
    // If parallel, it should be close to 500ms + overhead.
    // We assert it took LESS than 1000ms to prove parallel execution.
    assertGreater(1000, duration, "Readers should run in parallel");
  },
});

Deno.test({
  name: "RwLock: Writer blocks readers",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const buffer = new SharedArrayBuffer(1);
    const state = new Uint8Array(buffer);
    const lock = new RwLock(state);

    // 1. Spawn a Writer that holds the lock for 500ms
    const writer = spawn(move(lock), async (l) => {
      using guard = await l.write();
      await new Promise((r) => setTimeout(r, 500));
      guard.value[0] = 42;
    });

    // 2. Spawn a Reader immediately after
    // It should NOT be able to read until the writer finishes (~500ms later)
    const readerStart = performance.now();

    // Slight delay to ensure writer gets there first (race condition prevention in test)
    await new Promise((r) => setTimeout(r, 50));

    const reader = spawn(move(lock), async (l) => {
      const guard = await l.read();
      return guard.value[0];
    });

    const result = await reader.join(); // IT HANGS HERE
    const duration = performance.now() - readerStart;

    await writer.join();

    console.log(`Reader waited ${duration.toFixed(0)}ms`);

    // Validation:
    assertEquals(result.ok, true);
    // @ts-ignore: checking value
    assertEquals(result.value, 42, "Reader should see updated value");
    // Should have waited at least 400ms (accounting for the 50ms delay we added)
    assertGreater(duration, 400, "Reader should have been blocked by writer");
  },
});
