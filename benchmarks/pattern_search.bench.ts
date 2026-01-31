import { move, RwLock, spawn } from "multithreading";

const WORKERS = navigator.hardwareConcurrency;
const SIZE = 10_000_000;
export const PATTERN = [0, 3, 1, 2];

const view = new Int8Array(new SharedArrayBuffer(SIZE));
for (let i = 0; i < SIZE; i++) view[i] = Math.floor(Math.random() * 4);

const db = new RwLock(view);

export function search(
  data: Int8Array,
  pattern: number[],
  start: number,
  end: number,
): number {
  let count = 0;
  const limit = end - pattern.length;

  for (let i = start; i < limit; i++) {
    let match = true;
    for (let j = 0; j < pattern.length; j++) {
      if (data[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    if (match) count++;
  }
  return count;
}

Deno.bench("Standard JS", {
  group: "pattern_search",
}, () => {
  search(new Int8Array(view.buffer), PATTERN, 0, SIZE);
});

Deno.bench(
  "multithreading",
  { group: "pattern_search" },
  async () => {
    const chunk = Math.floor(SIZE / WORKERS);
    const tasks = [];

    for (let i = 0; i < WORKERS; i++) {
      const start = i * chunk;
      const end = (i === WORKERS - 1) ? SIZE : (i + 1) * chunk;

      tasks.push(
        spawn(move(db, start, end), async (db, start, end) => {
          const { search, PATTERN } = await import("./pattern_search.bench.ts");
          using guard = await db.read();

          return search(guard.value, PATTERN, start, end);
        }),
      );
    }

    await Promise.all(tasks.map((t) => t.join()));
  },
);
