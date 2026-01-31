const SIZE = 1024 * 1024 * 5; // 5MB
const DATA = new Float32Array(SIZE).fill(1.5);

export function process(d: Float32Array) {
  return d[0]! + d[d.length - 1]!;
}

Deno.bench(
  "comlink",
  { group: "typed_arrays" },
  async () => {
    const Comlink = await import("comlink");

    const workerCode = `
      import * as Comlink from "comlink";
      Comlink.expose({ 
        process(d: Float32Array) {
          return d[0]! + d[d.length - 1]!;
        }
      });
    `;
    const blob = new Blob([workerCode], { type: "application/typescript" });
    const worker = new Worker(URL.createObjectURL(blob), { type: "module" });
    const api = Comlink.wrap<{ process(d: Float32Array): number }>(worker);

    await api.process(DATA);
  },
);

Deno.bench(
  "multithreading",
  { group: "typed_arrays" },
  async () => {
    const { move, spawn, shutdown } = await import(
      "multithreading"
    );

    await spawn(move(DATA), (d) => {
      return d[0]! + d[d.length - 1]!;
    }).join();

    shutdown();
  },
);
