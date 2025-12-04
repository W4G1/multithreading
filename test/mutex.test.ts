import { assertEquals } from "@std/assert";
import { move, Mutex, spawn } from "../lib/lib.ts";

Deno.test("Mutex async", async () => {
  const sab = new SharedArrayBuffer(4);
  const sharedInt = new Int32Array(sab);
  const mutex = new Mutex(sharedInt);

  const handle1 = spawn(move(mutex), async (lock) => {
    using _guard = await lock.acquire();

    console.log("Handle1 has lock");

    await new Promise((r) => setTimeout(r, 500));
  });

  await new Promise((r) => setTimeout(r, 100));

  const handle2 = spawn(move(mutex), async (lock) => {
    using _guard = await lock.acquire();

    console.log("Handle2 has lock");
  });

  await Promise.all([handle1.join(), handle2.join()]);
});

Deno.test("Mutex sync", async () => {
  const sab = new SharedArrayBuffer(4);
  const sharedInt = new Int32Array(sab);
  const mutex = new Mutex(sharedInt);

  const handle1 = spawn(move(mutex), (lock) => {
    using _guard = lock.acquireSync();
    console.log("Handle1 has lock");

    let i = 0;

    while (i < 100000) {
      crypto.getRandomValues(new Uint8Array(1024));
      i++;
    }
  });

  await new Promise((r) => setTimeout(r, 50));

  const handle2 = spawn(move(mutex), (lock) => {
    using _guard = lock.acquireSync();
    console.log("Handle2 has lock");
  });

  await Promise.all([handle1.join(), handle2.join()]);
});

Deno.test("Mutex with Shared Memory (Int32Array)", async () => {
  // 1. Setup Shared Memory
  const sab = new SharedArrayBuffer(4);
  const sharedInt = new Int32Array(sab);
  const mutex = new Mutex(sharedInt);

  // 2. Spawn Worker
  const handle = spawn(move(mutex), (lock) => {
    using guard = lock.acquireSync();
    // Mutate the shared value
    guard.value[0] = 42;
    return guard.value[0];
  });

  await handle.join();

  // 3. Verification
  // The update SHOULD propagate because it's backed by SharedArrayBuffer
  assertEquals(sharedInt[0], 42, "Shared memory update failed to propagate.");
});

Deno.test("Mutex increment async", async () => {
  // 1. Setup Shared Memory
  const sab = new SharedArrayBuffer(4);
  const sharedInt = new Int32Array(sab);
  const mutex = new Mutex(sharedInt);

  // 2. Spawn Worker
  const handle1 = spawn(move(mutex), async (lock) => {
    using guard = await lock.acquire();

    await new Promise((r) => setTimeout(r, 500));

    // Mutate the shared value
    guard.value[0]! += 10;
  });

  await new Promise((r) => setTimeout(r, 50));

  const handle2 = spawn(move(mutex), async (lock) => {
    using guard = await lock.acquire();

    // Mutate the shared value
    guard.value[0]! += 10;
  });

  await Promise.all([handle1.join(), handle2.join()]);

  // 3. Verification
  // The update SHOULD propagate because it's backed by SharedArrayBuffer
  assertEquals(sharedInt[0], 20, "Shared memory update failed to propagate.");
});

Deno.test("Mutex with No Data (void)", async () => {
  // 1. Setup Empty Mutex
  const mutex = new Mutex(); // Infer <void>

  // 2. Spawn Worker
  const handle = spawn(move(mutex), (lock) => {
    using guard = lock.acquireSync();
    // Guard.value should be undefined
    return guard.value;
  });

  const result = await handle.join();
  if (!result.ok) throw result.error;

  // 3. Verification
  assertEquals(
    result.value,
    undefined,
    "Empty Mutex should have undefined value.",
  );
});

Deno.test("Mutex with Transferable Data (Standard Int32Array)", async () => {
  // 1. Setup Standard Memory (Not Shared)
  const buffer = new ArrayBuffer(4);
  const transferInt = new Int32Array(buffer);
  transferInt[0] = 123;

  const mutex = new Mutex(transferInt);

  // 2. Spawn Worker
  const handle = spawn(move(mutex), (lock) => {
    using guard = lock.acquireSync();

    const val = guard.value[0];
    // Mutate the local (transferred) copy
    guard.value[0] = 456;

    return val;
  });

  const result = await handle.join();
  if (!result.ok) throw result.error;

  // 3. Immediate Verification in Main Thread
  // Because it was backed by a standard ArrayBuffer, it should have been TRANSFERRED.
  // This means the Main Thread view is now detached (length 0).
  assertEquals(
    transferInt.byteLength,
    0,
    "Standard TypedArray should be detached (transferred) from Main thread.",
  );

  // 4. Verification
  assertEquals(
    result.value,
    123,
    "Worker should have received the original value.",
  );
});
