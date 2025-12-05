import { assert, assertEquals } from "@std/assert";
import { channel, move, spawn } from "../lib/lib.ts";

Deno.test("MPMC - Empty Channel Blocks Receiver", async () => {
  const [tx, rx] = channel<string>(5);

  const receiver = spawn(move(rx), async (rx) => {
    const start = Date.now();
    const res = await rx.recv(); // Blocks
    return {
      dt: Date.now() - start,
      val: res.ok ? res.value : null,
    };
  });

  await new Promise((r) => setTimeout(r, 100)); // Ensure receiver is stuck
  await tx.send("hello");

  const res = await receiver.join();
  assert(res.ok);
  assert(res.value.dt >= 80, "Receiver did not wait for data");
  assertEquals(res.value.val, "hello");
});
