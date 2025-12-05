import { assertEquals } from "@std/assert";
import { channel, move, spawn } from "../lib/lib.ts";

Deno.test("MPMC - Async Iterator Pattern", async () => {
  const [tx, rx] = channel<number>(10);

  spawn(move(tx), async (tx) => {
    await tx.send(1);
    await tx.send(2);
    await tx.send(3);
    tx.close();
  });

  const received = [];

  // If your library supports async iterators, this works.
  // If not, you can implement it easily:
  // [Symbol.asyncIterator]() { return { next: async () => { ... } } }

  // Simulating manual iteration loop:
  while (true) {
    const res = await rx.recv();
    if (!res.ok) break;
    received.push(res.value);
  }

  assertEquals(received, [1, 2, 3]);
});
