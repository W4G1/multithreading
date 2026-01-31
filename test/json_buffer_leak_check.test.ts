import { assert } from "@std/assert";
import { SharedJsonBuffer } from "multithreading";

declare const gc: () => void;

Deno.test("Deterministic Leak Check (Scoped)", async () => {
  if (typeof gc !== "function") {
    throw new Error('Run with: deno test --v8-flags="--expose-gc"');
  }

  const buffer = new SharedJsonBuffer<any>([]);
  // Access internal instance
  const internalInstance = (buffer[Symbol.iterator]() as any).buffer;
  const getTrackedCount = () => internalInstance.activeTargets.size;

  const initialCount = getTrackedCount();

  // We put the loop in a function. When this function returns,
  // V8 knows for sure that '_item' is dead.
  (function createGarbage() {
    for (let i = 0; i < 100; i++) {
      buffer.push({ id: i });
      // Create Proxy (and discard it immediately)
      const _item = buffer[i];
    }
  })();

  // Multiple passes to ensure WeakRefs and Finalizers are processed
  gc();
  await new Promise((r) => setTimeout(r, 10));
  gc();
  await new Promise((r) => setTimeout(r, 10));

  const finalCount = getTrackedCount();

  assert(
    finalCount < initialCount + 50,
    `Leak Confirmed: Count stayed high at ${finalCount}`,
  );
});
