import { assertEquals } from "@std/assert";
import { SharedJsonBuffer } from "multithreading";

Deno.test("Flyweight Iterator Bug", () => {
  const buffer = new SharedJsonBuffer([{ a: 1 }, { a: 2 }]);
  const items = [...buffer]; // Spread calls iterator
  assertEquals(items[0]!.a, 1);
  assertEquals(items[1]!.a, 2);
});
