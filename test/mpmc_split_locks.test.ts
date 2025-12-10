import { channel, move, spawn } from "../src/deno/lib.ts";

Deno.test("MPMC - Split Locks (Sender does not block Receiver)", async () => {
  const [tx, rx] = channel<number>(10);
  await tx.send(1);
  await tx.send(2);

  const p1 = spawn(move(tx), async (tx) => {
    for (let i = 0; i < 100; i++) await tx.send(i);
  });

  const c1 = spawn(move(rx), async (rx) => {
    // Read the initial 2
    await rx.recv();
    await rx.recv();
    // Read the rest
    for (let i = 0; i < 100; i++) await rx.recv();
  });

  await Promise.all([p1.join(), c1.join()]);
});
