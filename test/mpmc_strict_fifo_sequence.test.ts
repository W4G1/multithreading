import { assert, assertEquals } from "@std/assert";
import { channel, move, spawn } from "../lib/lib.ts";

Deno.test("MPMC - Strict FIFO Sequence (Single Producer -> Single Consumer)", async () => {
  const [tx, rx] = channel<number>(100);
  const COUNT = 1000;

  spawn(move(tx, COUNT), async (tx, COUNT) => {
    for (let i = 0; i < COUNT; i++) {
      await tx.send(i);
    }
  });

  let nextExpected = 0;
  while (nextExpected < COUNT) {
    const res = await rx.recv();
    assert(res.ok);
    assertEquals(
      res.value,
      nextExpected,
      `Order violation at index ${nextExpected}`,
    );
    nextExpected++;
  }

  // Allow enough time for any timers to clean up
  await new Promise((r) => setTimeout(r, 50));
});
