import { assertEquals } from "@std/assert";
import { channel, move, spawn } from "../lib/lib.ts";

Deno.test("MPMC - Stress Test (4 Producers -> 4 Consumers)", async () => {
  const [tx, rx] = channel<number>(100); // Buffer smaller than total items
  const ITEMS_PER_PRODUCER = 500;
  const PRODUCER_COUNT = 4;
  const CONSUMER_COUNT = 4;

  const producers = [];
  for (let i = 0; i < PRODUCER_COUNT; i++) {
    const myTx = tx.clone();

    // FIX: Pass ITEMS_PER_PRODUCER via move()
    producers.push(spawn(move(myTx, ITEMS_PER_PRODUCER), async (tx, count) => {
      for (let j = 0; j < count; j++) {
        await tx.send(1); // Just sending 1s for easy summing
      }
    }));
  }

  const consumers = [];
  for (let i = 0; i < CONSUMER_COUNT; i++) {
    const myRx = rx.clone();

    // Consumers don't strictly need the count, they run until close
    consumers.push(spawn(move(myRx), async (rx) => {
      let count = 0;
      while (true) {
        const res = await rx.recv();
        if (!res.ok) break; // Channel closed
        count += res.value;
      }
      return count;
    }));
  }

  // Wait for all producers to finish
  await Promise.all(producers.map((p) => p.join()));

  // Close channel so consumers can exit loop
  tx.close();

  // Wait for consumers
  const consumerResults = await Promise.all(consumers.map((c) => c.join()));

  const totalReceived = consumerResults.reduce((acc, res) => {
    if (!res.ok) throw res.error;
    return acc + res.value;
  }, 0);

  const expectedTotal = ITEMS_PER_PRODUCER * PRODUCER_COUNT; // 2000
  assertEquals(totalReceived, expectedTotal);
});
