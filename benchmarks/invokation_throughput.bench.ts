const INVOKATIONS = 10000;

Deno.bench(
  "native (Sequential)",
  { group: "invokation_throughput" },
  async (t) => {
    const workerCode = `
      self.onmessage = () => {
        self.postMessage("Done");
      };
    `;
    const blob = new Blob([workerCode], { type: "application/typescript" });
    const worker = new Worker(URL.createObjectURL(blob), { type: "module" });

    const run = () =>
      new Promise((resolve) => {
        worker.onmessage = (e) => resolve(e.data);
        worker.postMessage(undefined);
      });

    t.start();
    for (let i = 0; i < INVOKATIONS; i++) {
      await run();
    }
    t.end();

    worker.terminate();
  },
);

Deno.bench(
  "native (Parallel)",
  { group: "invokation_throughput" },
  async (t) => {
    const workerCode = `
      self.onmessage = (e) => {
        // Echo the ID back to match the promise
        self.postMessage({ id: e.data, result: "Done" });
      };
    `;
    const blob = new Blob([workerCode], { type: "application/typescript" });
    const worker = new Worker(URL.createObjectURL(blob), { type: "module" });

    const promises = new Map<number, (val: any) => void>();

    worker.onmessage = (e) => {
      const { id, result } = e.data;
      const resolve = promises.get(id);
      if (resolve) {
        resolve(result);
        promises.delete(id);
      }
    };

    t.start();
    const tasks = new Array(INVOKATIONS);
    for (let i = 0; i < INVOKATIONS; i++) {
      tasks[i] = new Promise((resolve) => {
        promises.set(i, resolve);
        worker.postMessage(i);
      });
    }

    await Promise.all(tasks);
    t.end();

    worker.terminate();
  },
);

Deno.bench(
  "comlink (Sequential)",
  { group: "invokation_throughput" },
  async (t) => {
    const Comlink = await import("comlink");

    const workerCode = `
      import * as Comlink from "comlink";
      Comlink.expose({
        run() { return "Done"; }
      });
    `;
    const blob = new Blob([workerCode], { type: "application/typescript" });
    const worker = new Worker(URL.createObjectURL(blob), { type: "module" });
    const api = Comlink.wrap<{ run(): "Done" }>(worker);

    t.start();
    for (let i = 0; i < INVOKATIONS; i++) {
      await api.run();
    }
    t.end();

    worker.terminate();
  },
);

Deno.bench(
  "comlink (Parallel)",
  { group: "invokation_throughput" },
  async (t) => {
    const Comlink = await import("comlink");

    const workerCode = `
      import * as Comlink from "comlink";
      Comlink.expose({ 
        run() { return "Done"; }
      });
    `;
    const blob = new Blob([workerCode], { type: "application/typescript" });
    const worker = new Worker(URL.createObjectURL(blob), { type: "module" });
    const api = Comlink.wrap<{ run(): "Done" }>(worker);

    const arr = new Array(INVOKATIONS);

    t.start();
    for (let i = 0; i < INVOKATIONS; i++) {
      arr[i] = api.run();
    }
    await Promise.all(arr);
    t.end();

    worker.terminate();
  },
);

Deno.bench(
  "multithreading (Sequential)",
  { group: "invokation_throughput" },
  async (t) => {
    const { spawn, shutdown } = await import("multithreading");

    t.start();
    for (let i = 0; i < INVOKATIONS; i++) {
      await spawn(() => {
        return "Done";
      }).join();
    }
    t.end();

    shutdown();
  },
);

Deno.bench(
  "multithreading (Parallel)",
  { group: "invokation_throughput" },
  async (t) => {
    const { spawn, shutdown } = await import("multithreading");

    const arr = new Array(INVOKATIONS);

    t.start();
    for (let i = 0; i < INVOKATIONS; i++) {
      arr[i] = spawn(() => {
        return "Done";
      }).join();
    }
    await Promise.all(arr);
    t.end();

    shutdown();
  },
);
