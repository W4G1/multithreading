import { move, spawn } from "multithreading";

// Note: Has to be exported
export function sum(a: number, b: number) {
  return a + b;
}

const handle = spawn(move(5, 10), async (n1, n2) => {
  const { sum } = await import("./function_from_same_file.ts");
  return sum(n1, n2);
});

const result = await handle.join(); // { ok: true, value: 15 }
