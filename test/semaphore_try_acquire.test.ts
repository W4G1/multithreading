import { assertEquals } from "@std/assert";
import { move, Semaphore, spawn } from "../lib/lib.ts";

Deno.test("Semaphore tryAcquire (Conditional 'using')", async () => {
  const sem = new Semaphore(1);

  const handle = spawn(move(sem), (s) => {
    // 1. Successful Try
    const guard = s.tryAcquire();
    if (!guard) throw new Error("Failed to acquire free semaphore");

    {
      using _g = guard;
      // 2. Failed Try (inside lock)
      if (s.tryAcquire() !== null) {
        throw new Error("Double acquire should fail");
      }
    } // Released here

    // 3. Successful Try (after scope)
    if (!s.tryAcquire()) throw new Error("Should be free again");

    return true;
  });

  const result = await handle.join();
  if (!result.ok) throw result.error;
  assertEquals(result.ok, true);
});
