const BATCH_SIZE = 500;

export const FIB_N = 30;

export function fib(n: number): number {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}

Deno.bench(
  "Standard JS",
  { group: "fibonacci" },
  (t) => {
    t.start();
    for (let i = 0; i < BATCH_SIZE; i++) {
      fib(FIB_N);
    }
    t.end();
  },
);

Deno.bench(
  "multithreading",
  { group: "fibonacci" },
  async (t) => {
    const { spawn, shutdown } = await import("multithreading");
    const tasks = new Array(BATCH_SIZE);

    t.start();
    for (let i = 0; i < BATCH_SIZE; i++) {
      tasks.push(spawn(async () => {
        const { fib, FIB_N } = await import("./fibonacci.bench.ts");
        fib(FIB_N);
      }));
    }
    await Promise.all(tasks.map((t) => t.join()));
    t.end();

    shutdown();
  },
);
