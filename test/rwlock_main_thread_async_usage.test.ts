import { assertEquals } from "@std/assert";
import { RwLock } from "../src/deno/lib.ts";

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
