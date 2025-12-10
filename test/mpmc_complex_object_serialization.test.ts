import { assertEquals } from "@std/assert/equals";
import { channel, move, spawn } from "../src/deno/lib.ts";
import { assert } from "@std/assert";

Deno.test("MPMC - Complex Object Serialization", async () => {
  type ComplexData = {
    id: number;
    meta: { tags: string[] };
    buffer: number[];
  };

  const [tx, rx] = channel<ComplexData>(5);

  const complexObj: ComplexData = {
    id: 1,
    meta: { tags: ["a", "b"] },
    buffer: [1, 2, 3],
  };

  spawn(move(tx, complexObj), async (tx, obj) => {
    await tx.send(obj);
  });

  const res = await rx.recv();
  assert(res.ok);

  const result = await tx.send({
    id: 1,
    meta: { tags: ["a", "b"] },
    buffer: [1, 2, 3],
  });

  assert(!result.ok); // Should error because tx is moved

  const val = res.value;

  assertEquals(val.id, 1);
  assertEquals(val.meta.tags.length, 2);
  assertEquals(val.meta.tags[0], "a");
  assertEquals(val.meta.tags[1], "b");
  assertEquals(val.buffer instanceof Array, true);
  assertEquals(val.buffer[2], 3);
});
