import { assertEquals } from "@std/assert";
import { channel, move, spawn } from "../src/deno/lib.ts";

Deno.test("MPMC - Async Iterator Pattern", async () => {
  const [tx, rx] = channel<number>(10);

  spawn(move(tx), async (tx) => {
    await tx.send(1);
    await tx.send(2);
    await tx.send(3);
    tx.close();
  });

  const received = [];

  for await (const value of rx) {
    received.push(value);
  }

  assertEquals(received, [1, 2, 3]);
});
