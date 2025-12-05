import { assertEquals, assertGreater } from "@std/assert";
import { move, RwLock, spawn } from "../lib/lib.ts";

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
