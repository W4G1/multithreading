import { assert, assertEquals } from "@std/assert";
import { channel, move, spawn } from "../lib/lib.ts";

Deno.test("MPMC - Close Wakes All Waiters", async () => {
  // Scenario: Channel is empty. 3 Receivers are waiting.
  // We close the channel. All 3 should wake up and error.
  const [tx, rx] = channel<number>(10);

  const waiters = [1, 2, 3].map(() => {
    return spawn(move(rx.clone()), async (rx) => {
      const res = await rx.recv();
      return res.ok ? "data" : "closed";
    });
  });

  await new Promise((r) => setTimeout(r, 50));

  tx.close();

  const results = await Promise.all(waiters.map((w) => w.join()));

  results.forEach((r) => {
    assert(r.ok);
    assertEquals(r.value, "closed");
  });
});
