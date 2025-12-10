import { assertEquals } from "@std/assert";
import { move, Semaphore, spawn } from "../src/deno/lib.ts";

Deno.test("Semaphore Multi-Permit (Batch 'using')", async () => {
  const sem = new Semaphore(5);

  const handle = spawn(move(sem), (s) => {
    {
      // Grab all 5 permits
      using _guard = s.blockingAcquire(5);
      if (s.tryAcquire(1) !== null) {
        throw new Error("Should have exhausted permits");
      }
    } // Released 5 here

    // Should be free again
    using _guard2 = s.blockingAcquire(5);
    return true;
  });

  const result = await handle.join();
  assertEquals(result.ok, true);
});
