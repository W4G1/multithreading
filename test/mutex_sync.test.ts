import { move, Mutex, spawn } from "../src/deno/lib.ts";
import { initRuntime } from "../src/lib/lib.ts";

initRuntime({ maxWorkers: 2 });

Deno.test("Mutex sync", async () => {
  const sharedInt = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  );
  const mutex = new Mutex(sharedInt);

  const handle1 = spawn(move(mutex), (lock) => {
    using _guard = lock.blockingLock();

    let i = 0;

    while (i < 100000) {
      crypto.getRandomValues(new Uint8Array(1024));
      i++;
    }
  });

  await new Promise((r) => setTimeout(r, 50));

  const handle2 = spawn(move(mutex), (lock) => {
    using _guard = lock.blockingLock();
  });

  await Promise.all([handle1.join(), handle2.join()]);
});
