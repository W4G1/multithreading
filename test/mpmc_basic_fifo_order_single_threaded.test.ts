import { assertEquals } from "@std/assert";
import { channel } from "../src/lib/lib.ts";

Deno.test("MPMC - Basic FIFO Order (Single Threaded Logic)", async () => {
  const [tx, rx] = channel<number>(10);

  await tx.send(1);
  await tx.send(2);
  await tx.send(3);

  const r1 = await rx.recv();
  const r2 = await rx.recv();
  const r3 = await rx.recv();

  assertEquals((r1 as any).value, 1);
  assertEquals((r2 as any).value, 2);
  assertEquals((r3 as any).value, 3);
});
