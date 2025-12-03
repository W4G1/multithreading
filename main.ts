import { drop, move, Mutex, shutdown, spawn } from "./lib/lib.ts";

const sab = new SharedArrayBuffer(4);
const sharedInt = new Int32Array(sab);
const mutex = new Mutex(sharedInt);

const handle1 = spawn(move(mutex), async (lock) => {
  const { drop } = await import("./lib/lib.ts");
  const { createHmac } = await import("node:crypto");

  const guard = await lock.acquire();

  console.log("Handle1 has lock");

  const secret = "abcdefg";
  const hash = createHmac("sha256", secret)
    .update("I love cupcakes")
    .digest("hex");
  console.log(hash);

  await new Promise((r) => setTimeout(r, 1000));

  drop(guard);
});

await new Promise((r) => setTimeout(r, 500));

const handle2 = spawn(move(mutex), async (lock) => {
  const { drop } = await import("./lib/lib.ts");
  const guard = await lock.acquire();

  console.log("Handle2 has lock");
  drop(guard);
});

const handle3 = spawn(async () => {
  // const { sum } = await import("./utils.ts");
  const a: number = 5;
  const b: number = 10;

  return a + b;
});

console.log(
  await Promise.all([handle1.join(), handle2.join(), handle3.join()]),
);

console.log("done!");

shutdown();
