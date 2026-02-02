Deno.bench(
  "native",
  { group: "cold_start" },
  async (t) => {
    t.start();
    const workerCode = `
      self.onmessage = () => {
        self.postMessage("Done");
      };
    `;
    const blob = new Blob([workerCode], { type: "application/typescript" });
    const worker = new Worker(URL.createObjectURL(blob), { type: "module" });

    await new Promise((resolve) => {
      worker.onmessage = (e) => {
        if (e.data === "Done") resolve(e.data);
      };
      worker.postMessage("run");
    });
    t.end();

    worker.terminate();
  },
);

Deno.bench(
  "comlink",
  { group: "cold_start" },
  async (t) => {
    t.start();
    const Comlink = await import("comlink");

    const workerCode = `
      import * as Comlink from "comlink";
      Comlink.expose({ 
        run() {
          return "Done";
        }
      });
    `;
    const blob = new Blob([workerCode], { type: "application/typescript" });
    const worker = new Worker(URL.createObjectURL(blob), { type: "module" });
    const api = Comlink.wrap<{ run(): "Done" }>(worker);

    await api.run();
    t.end();

    worker.terminate();
  },
);

Deno.bench(
  "multithreading",
  { group: "cold_start" },
  async (t) => {
    t.start();
    const { spawn, shutdown } = await import("multithreading");

    await spawn(() => {
      return "Done";
    }).join();
    t.end();

    shutdown();
  },
);
