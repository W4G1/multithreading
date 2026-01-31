const ITEM_COUNT = 10_000;
const TRANSACTION_COUNT = 50;
const BUFFER_SIZE = 1024 * 1024 * 15; // 15MB

const INITIAL_DATA = {
  metadata: {
    id: "dataset-large-v1",
    createdAt: Date.now(),
    tags: ["benchmark", "performance", "concurrency"],
    status: "active",
  },
  users: Array.from({ length: ITEM_COUNT }, (_, i) => ({
    id: i,
    name: `User_${i}`,
    preferences: {
      notifications: i % 2 === 0,
      theme: i % 3 === 0 ? "dark" : "light",
    },
    history: [i, i * 2, i * 3],
    lastLogin: Date.now(),
    loginCount: 0,
  })),
};

Deno.bench(
  "comlink (Structured Cloning)",
  { group: "parallel_json_patching" },
  async () => {
    const Comlink = await import("comlink");

    const workerCode = `
      import * as Comlink from "comlink";

      Comlink.expose({
        run(data: any) {
          const idx = Math.floor(Math.random() * data.users.length);
          data.users[idx]!.loginCount++;
          data.users[idx]!.lastLogin = Date.now();
          return data;
        } 
      });
    `;

    const worker = new Worker(
      URL.createObjectURL(
        new Blob([workerCode], { type: "application/typescript" }),
      ),
      { type: "module" },
    );

    const comlinkApi = Comlink.wrap<{
      run(data: typeof INITIAL_DATA): typeof INITIAL_DATA;
    }>(worker);

    let currentData = INITIAL_DATA;

    for (let i = 0; i < TRANSACTION_COUNT; i++) {
      currentData = await comlinkApi.run(currentData);
    }

    worker.terminate();
  },
);

Deno.bench(
  "multithreading (SharedJsonBuffer + Mutex)",
  { group: "parallel_json_patching" },
  async () => {
    const { move, Mutex, SharedJsonBuffer, spawn, shutdown } = await import(
      "multithreading"
    );

    const mutex = new Mutex(
      new SharedJsonBuffer(INITIAL_DATA, {
        size: BUFFER_SIZE,
      }),
    );

    for (let i = 0; i < TRANSACTION_COUNT; i++) {
      await spawn(move(mutex), async (m) => {
        using guard = await m.lock();
        const data = guard.value;

        const idx = Math.floor(Math.random() * data.users.length);
        data.users[idx]!.loginCount++;
        data.users[idx]!.lastLogin = Date.now();
      }).join();
    }

    shutdown();
  },
);
