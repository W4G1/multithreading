import { assertEquals } from "@std/assert";
import { move, RwLock, spawn } from "../src/deno/lib.ts";

Deno.test("RwLock: Readers do not block Readers", async () => {
  // This test ensures that multiple readers can access data concurrently.
  // While we can't easily assert "exact simultaneity" in a unit test without timing flake,
  // we can ensure that multiple readers complete successfully and see the correct data.

  const data = new Uint8Array(
    new SharedArrayBuffer(Uint8Array.BYTES_PER_ELEMENT),
  );
  data[0] = 128; // specific value to check
  const lock = new RwLock(data);

  const readerFn = (lock: RwLock<Uint8Array>) => {
    // Acquire read lock multiple times
    for (let i = 0; i < 10; i++) {
      using guard = lock.blockingRead();
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
