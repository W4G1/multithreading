import { assertEquals } from "@std/assert";
import { channel, move, spawn } from "../src/deno/lib.ts";
import { assert } from "@std/assert/assert";

Deno.test("MPMC - Multiple Consumers (Load Balancing)", async () => {
  const [tx, rx] = channel<number>(10);

  // Clone the receiver for a second worker
  const rx2 = rx.clone();

  // Helper to simulate work
  // We use a tiny delay to prevent one worker from eating everything in a tight loop
  const workFn = async (rx: any) => {
    const received = [];
    while (true) {
      const res = await rx.recv();
      if (!res.ok) break;
      received.push(res.value);
      // Simulate 1ms of processing time
      await new Promise((r) => setTimeout(r, 1));
    }
    return received;
  };

  // Spawn Worker A
  const workerA = spawn(move(rx), workFn);

  // Spawn Worker B
  const workerB = spawn(move(rx2), workFn);

  // Give workers time to spin up and block on recv()
  await new Promise((r) => setTimeout(r, 100));

  // Send 50 items (Increased from 10)
  for (let i = 0; i < 50; i++) {
    await tx.send(i);
  }

  tx.close();

  const resA = await workerA.join();
  const resB = await workerB.join();

  assert(resA.ok && resB.ok);

  const allReceived = [...resA.value, ...resB.value].sort((a, b) => a - b);

  // Verify data integrity
  assertEquals(allReceived.length, 50);
  assertEquals(allReceived[0], 0);
  assertEquals(allReceived[49], 49);

  assert(resA.value.length > 0, "Worker A did no work");
  assert(resB.value.length > 0, "Worker B did no work");
});
