import { assertEquals } from "@std/assert";
import { channel, move, spawn } from "../lib/lib.ts";

Deno.test("MPMC - Multiple Producers (Clone & Contention)", async () => {
  const [tx, rx] = channel<number>(50);
  const tx2 = tx.clone();

  const p1 = spawn(move(tx), async (s) => {
    for (let i = 0; i < 20; i++) await s.send(1);
  });

  const p2 = spawn(move(tx2), async (s) => {
    for (let i = 0; i < 20; i++) await s.send(2);
  });

  let sum = 0;
  for (let i = 0; i < 40; i++) {
    const res = await rx.recv();
    if (res.ok) sum += res.value;
  }

  await Promise.all([p1.join(), p2.join()]);

  // 20 * 1 + 20 * 2 = 20 + 40 = 60
  assertEquals(sum, 60);

  // Allow enough time for any timers to clean up
  await new Promise((r) => setTimeout(r, 50));
});
