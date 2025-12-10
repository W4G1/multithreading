import { assertEquals } from "@std/assert/equals";
import { channel, move, spawn } from "../src/deno/lib.ts";
import { assert } from "@std/assert";

Deno.test("MPMC - Backpressure (Full Channel Blocks Sender)", async () => {
  const [tx, rx] = channel<number>(1); // Capacity 1

  await tx.send(100); // Fills the 1 slot

  const sender = spawn(move(tx), async (tx) => {
    const start = Date.now();
    await tx.send(200); // Should block here
    return Date.now() - start;
  });

  await new Promise((r) => setTimeout(r, 100)); // Ensure sender is stuck

  const r1 = await rx.recv(); // Read 100, freeing slot
  assertEquals((r1 as any).value, 100);

  const res = await sender.join();
  assert(res.ok);
  assert(res.value >= 80, "Sender did not wait for capacity");

  const r2 = await rx.recv(); // Read 200
  assertEquals((r2 as any).value, 200);
});
