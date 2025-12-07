import { assertEquals, assertFalse } from "@std/assert";
import { move, spawn } from "../lib/lib.ts";
import { channel } from "../lib/sync/mpmc.ts";

Deno.test("MPMC - Auto Close via 'using' (Sender Drop)", async () => {
  const [tx, rx] = channel<number>(10);

  // Spawn a worker that adopts the sender
  spawn(move(tx), async (tx) => {
    await tx.send(100);
    await tx.send(200);
    // Worker exits -> Ref count decrements
  });

  const r1 = await rx.recv();
  const r2 = await rx.recv();
  const r3 = await rx.recv();

  assertEquals((r1 as any).value, 100);
  assertEquals((r2 as any).value, 200);

  assertFalse(r3.ok, "Channel should have auto-closed after worker exit");
  assertEquals((r3 as any).error.message, "Channel closed");

  await new Promise((r) => setTimeout(r, 0));
});
