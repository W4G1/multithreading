import { assert, assertEquals, assertFalse } from "@std/assert";
import { channel } from "../src/deno/lib.ts";

Deno.test("MPMC - Manual Dispose (Main Thread)", async () => {
  const [tx, rx] = channel<number>(10);

  // Send one item
  await tx.send(1);

  // Manually dispose the sender on the main thread
  tx[Symbol.dispose]();

  // We can still read what's in the buffer
  const r1 = await rx.recv();
  assert(r1.ok);
  assertEquals(r1.value, 1);

  // But the next read should verify the channel is closed
  const r2 = await rx.recv();
  assertFalse(r2.ok);
});
