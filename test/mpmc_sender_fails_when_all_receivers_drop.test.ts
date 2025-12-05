import { assertFalse } from "@std/assert/false";
import { channel, move, spawn } from "../lib/lib.ts";
import { assert } from "@std/assert";

Deno.test("MPMC - Sender Fails when all Receivers Drop", async () => {
  const [tx, rx] = channel<number>(10);

  const worker = spawn(move(rx), async (rx) => {
    using _rx = rx; // Adopts the worker's handle (RX_COUNT goes up)
    // Worker exits -> _rx disposed -> RX_COUNT goes down
  });

  // Dispose the main thread's handle.
  // We have "moved" ownership to the worker, so we must drop our local reference.
  rx[Symbol.dispose]();

  await worker.join();

  // Now RX_COUNT should truly be 0.
  const res = await tx.send(1);

  assertFalse(res.ok, "Send should fail if no receivers exist");
  assert(
    res.error.message.includes("No Receivers") ||
      res.error.message.includes("closed"),
  );
});
