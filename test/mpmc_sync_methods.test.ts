import { assert } from "@std/assert";
import { channel, move, spawn } from "../lib/lib.ts";

Deno.test("MPMC - Sync Methods Work correctly", async () => {
  const [tx, rx] = channel<number>(5);

  spawn(move(tx), (tx) => {
    tx.blockingSend(1);
    tx.blockingSend(2);
  });

  // Wait a bit for worker to execute
  await new Promise((r) => setTimeout(r, 50));

  const r1 = rx.blockingRecv();
  const r2 = rx.blockingRecv();

  assert(r1.ok && r1.value === 1);
  assert(r2.ok && r2.value === 2);
});
