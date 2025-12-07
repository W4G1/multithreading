import { move, Mutex, spawn } from "../lib/lib.ts";

Deno.test("Mutex async", async () => {
  const sab = new SharedArrayBuffer(4);
  const sharedInt = new Int32Array(sab);
  const mutex = new Mutex(sharedInt);

  const handle1 = spawn(move(mutex), async (lock) => {
    using _guard = await lock.lock();

    await new Promise((r) => setTimeout(r, 500));
  });

  await new Promise((r) => setTimeout(r, 100));

  const handle2 = spawn(move(mutex), async (lock) => {
    using _guard = await lock.lock();
  });

  await Promise.all([handle1.join(), handle2.join()]);
});
