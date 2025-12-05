import { assert, assertEquals } from "@std/assert";
import { channel, move, spawn } from "../lib/lib.ts";

Deno.test("MPMC - Close Wakes Blocked Senders", async () => {
  // Scenario: Channel is full. Sender is waiting.
  const [tx1, rx1] = channel<number>(1);
  await tx1.send(1);
  const tx2 = tx1.clone();

  // We clone tx2 into the thread
  const sender2 = spawn(move(tx2), async (tx) => {
    const res = await tx.send(2);
    return res.ok;
  });

  await new Promise((r) => setTimeout(r, 50));
  tx1.close(); // Close via the handle we kept

  const res = await sender2.join();
  assert(res.ok);
  assertEquals(res.value, false, "Sender should return error on close");
});
