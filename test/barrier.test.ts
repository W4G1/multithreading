import { assert, assertEquals } from "@std/assert";
import { Barrier, move, spawn } from "../src/deno/lib.ts";
import { initRuntime } from "../src/lib/lib.ts";

initRuntime({ maxWorkers: 8 });

Deno.test("Barrier: Basic Rendezvous (N=3)", async () => {
  const barrier = new Barrier(3);
  const data = new Int32Array(
    new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT),
  );

  const p0 = spawn(move(barrier, data), (b, d) => {
    const id = 0;
    const start = Date.now();
    while (Date.now() - start < 100);

    d[id] = id + 1;
    b.blockingWait();

    let valid = true;
    for (let i = 0; i < 3; i++) {
      if (d[i] === 0) valid = false;
    }
    return valid;
  });

  const p1 = spawn(move(barrier, data), (b, d) => {
    const id = 1;
    d[id] = id + 1;
    b.blockingWait();

    let valid = true;
    for (let i = 0; i < 3; i++) {
      if (d[i] === 0) valid = false;
    }
    return valid;
  });

  const p2 = spawn(move(barrier, data), (b, d) => {
    const id = 2;
    d[id] = id + 1;
    b.blockingWait();

    let valid = true;
    for (let i = 0; i < 3; i++) {
      if (d[i] === 0) valid = false;
    }
    return valid;
  });

  const results = await Promise.all([p0.join(), p1.join(), p2.join()]);

  results.forEach((res, i) => {
    if (!res.ok) throw res.error;
    assert(res.value, `Worker ${i} saw incomplete data`);
  });
});

Deno.test("Barrier: Leader Election", async () => {
  const N = 5;
  const barrier = new Barrier(N);

  const handles = [];
  for (let i = 0; i < N; i++) {
    handles.push(
      spawn(move(barrier), (b) => {
        const res = b.blockingWait();
        return res.isLeader;
      }),
    );
  }

  const results = await Promise.all(handles.map((h) => h.join()));

  const leaderCount = results.reduce((acc, res) => {
    if (!res.ok) throw res.error;
    return acc + (res.value ? 1 : 0);
  }, 0);

  assertEquals(leaderCount, 1, "Exactly one thread should be the leader");
});

Deno.test("Barrier: Reuse & Generations (The 'ABA' Test)", async () => {
  const N = 4;
  const barrier = new Barrier(N);
  const sharedCounter = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  );

  const handles = [];
  for (let i = 0; i < N; i++) {
    handles.push(
      spawn(move(barrier, sharedCounter), (b, c) => {
        const iterations = 50;

        for (let k = 0; k < iterations; k++) {
          const res = b.blockingWait();

          if (res.isLeader) {
            Atomics.add(c, 0, 1);
          }

          b.blockingWait();

          const val = Atomics.load(c, 0);
          if (val !== k + 1) {
            throw new Error(
              `Desync at iteration ${k}. Expected ${k + 1}, got ${val}`,
            );
          }
        }
        return true;
      }),
    );
  }

  const results = await Promise.all(handles.map((h) => h.join()));

  results.forEach((res) => {
    if (!res.ok) throw res.error;
  });

  assertEquals(sharedCounter[0], 50);
});

Deno.test("Barrier: Async Main Thread + Blocking Workers", async () => {
  const barrier = new Barrier(2);
  const sharedState = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  );

  const worker = spawn(move(barrier, sharedState), (b, state) => {
    b.blockingWait();

    if (Atomics.load(state, 0) !== 10) return false;

    Atomics.store(state, 0, 20);

    b.blockingWait();

    return true;
  });

  Atomics.store(sharedState, 0, 10);

  await barrier.wait();
  await barrier.wait();

  assertEquals(Atomics.load(sharedState, 0), 20);

  const res = await worker.join();
  if (!res.ok) throw res.error;
  assert(res.value, "Worker saw incorrect state sequence");
});

Deno.test("Barrier: Edge Case (N=1)", async () => {
  const barrier = new Barrier(1);

  const res1 = barrier.blockingWait();
  assert(res1.isLeader, "N=1 should always be leader");

  const res2 = await barrier.wait();
  assert(res2.isLeader, "N=1 should be reusable immediately");
});

Deno.test("Barrier: Stress Test (N=8, 2000 Iterations)", async () => {
  const N = 8;
  const ITERATIONS = 2000;

  const barrier = new Barrier(N);
  const sharedCounter = new Int32Array(new SharedArrayBuffer(4));

  const handles = [];

  for (let i = 0; i < N; i++) {
    handles.push(
      spawn(move(barrier, sharedCounter, ITERATIONS), (b, c, iters) => {
        for (let k = 0; k < iters; k++) {
          if (Math.random() > 0.8) {
            const start = Date.now();
            while (Date.now() - start < 1);
          }

          const r1 = b.blockingWait();

          if (r1.isLeader) {
            const current = Atomics.load(c, 0);
            if (current !== k * 2) {
              throw new Error(`Leader desync start: ${current} vs ${k * 2}`);
            }
            Atomics.add(c, 0, 1);
          }

          const r2 = b.blockingWait();

          if (r2.isLeader) {
            const current = Atomics.load(c, 0);
            if (current !== (k * 2) + 1) {
              throw new Error(`Leader desync end: ${current}`);
            }
            Atomics.add(c, 0, 1);
          }
        }
        return true;
      }),
    );
  }

  const results = await Promise.all(handles.map((h) => h.join()));

  results.forEach((res) => {
    if (!res.ok) throw res.error;
  });

  assertEquals(sharedCounter[0], ITERATIONS * 2);
});

Deno.test("Barrier: Pure Main Thread Async (N=3)", async () => {
  const barrier = new Barrier(3);
  const log: string[] = [];

  const task = async (id: number, delayMs: number) => {
    await new Promise((r) => setTimeout(r, delayMs));
    log.push(`enter:${id}`);

    await barrier.wait();

    log.push(`exit:${id}`);
  };

  await Promise.all([
    task(1, 10),
    task(2, 50),
    task(3, 0),
  ]);

  const firstExitIndex = log.findIndex((entry) => entry.startsWith("exit"));
  const lastEnterIndex = log.findLastIndex((entry) =>
    entry.startsWith("enter")
  );

  assert(firstExitIndex > -1, "Tasks never exited");
  assert(
    firstExitIndex > lastEnterIndex,
    `Barrier Failed: An exit occurred before the last enter.\nLog: ${
      JSON.stringify(log)
    }`,
  );
});

Deno.test("Barrier: Workers using Async .wait()", async () => {
  const N = 3;
  const barrier = new Barrier(N);
  const sharedCounter = new Int32Array(new SharedArrayBuffer(4));

  const handles = [];
  for (let i = 0; i < N; i++) {
    handles.push(
      spawn(move(barrier, sharedCounter), async (b, c) => {
        const res1 = await b.wait();

        if (res1.isLeader) {
          Atomics.add(c, 0, 1);
        }

        await b.wait();

        return Atomics.load(c, 0);
      }),
    );
  }

  const results = await Promise.all(handles.map((h) => h.join()));

  results.forEach((res) => {
    if (!res.ok) throw res.error;
    assertEquals(res.value, 1);
  });
});

Deno.test("Barrier: Async Stress Fan-Out (N=50)", async () => {
  const N = 50;
  const barrier = new Barrier(N);
  let finishedCount = 0;

  const promises = Array.from({ length: N }).map(async (_, i) => {
    await new Promise((r) => setTimeout(r, Math.random() * 20));

    const res = await barrier.wait();

    finishedCount++;
    return res.isLeader;
  });

  const results = await Promise.all(promises);

  assertEquals(finishedCount, N);

  const leaders = results.filter((isLeader) => isLeader).length;
  assertEquals(leaders, 1, "Exactly one promise should resolve as leader");
});
