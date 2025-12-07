import { assert, assertEquals, assertExists } from "@std/assert";
import { SharedJsonBuffer } from "../lib/json_buffer.ts";

// --------------------------------------------------------------------------
// 1. Mutator Methods
// These methods modify the array in place.
// --------------------------------------------------------------------------

Deno.test("Array Mutators: Push, Pop, Shift, Unshift", () => {
  const db = new SharedJsonBuffer<number[]>([1, 2, 3]);

  // Push
  const newLen = db.push(4, 5);
  assertEquals(newLen, 5);
  assertEquals(db.length, 5);
  assertEquals(db[3], 4);
  assertEquals(db[4], 5);

  // Pop
  const popped = db.pop();
  assertEquals(popped, 5);
  assertEquals(db.length, 4);

  // Unshift (Add to beginning)
  const lenAfterUnshift = db.unshift(0);
  assertEquals(lenAfterUnshift, 5);
  assertEquals(db[0], 0);
  assertEquals(db[4], 4);

  // Shift (Remove from beginning)
  const shifted = db.shift();
  assertEquals(shifted, 0);
  assertEquals(db.length, 4);
  assertEquals(db[0], 1); // Indices should have shifted
});

Deno.test("Array Mutators: Splice (Insert, Delete, Replace)", () => {
  const db = new SharedJsonBuffer<string[]>(["a", "b", "c", "d", "e"]);

  // 1. Remove elements
  // Remove 2 elements starting at index 1 ('b', 'c')
  const removed = db.splice(1, 2);

  assertEquals(removed.length, 2);
  assertEquals(removed[0], "b");
  assertEquals(removed[1], "c");
  assertEquals(db.length, 3);
  assertEquals(db[1], "d"); // 'd' shifted down

  // 2. Insert elements
  // At index 1, remove 0, insert 'x', 'y'
  db.splice(1, 0, "x", "y");

  assertEquals(db.length, 5);
  assertEquals(db[1], "x");
  assertEquals(db[2], "y");
  assertEquals(db[3], "d");

  // 3. Replace elements
  // At index 4 ('e'), remove 1, insert 'z'
  db.splice(4, 1, "z");
  assertEquals(db[4], "z");
});

Deno.test("Array Mutators: Reverse, Sort, Fill, CopyWithin", () => {
  // Reverse
  const db1 = new SharedJsonBuffer<number[]>([1, 2, 3]);
  const reversed = db1.reverse();
  assertEquals(db1[0], 3);
  assertEquals(db1[2], 1);
  // Ensure the return value is the same proxy reference
  assertEquals(reversed, db1);

  // Sort
  const db2 = new SharedJsonBuffer<number[]>([3, 1, 4, 2]);
  db2.sort((a, b) => a - b);
  assertEquals(db2[0], 1);
  assertEquals(db2[3], 4);

  // Fill
  const db3 = new SharedJsonBuffer<number[]>([0, 0, 0, 0, 0]);
  db3.fill(7, 1, 4); // Fill with 7 from index 1 to 4 (exclusive)
  assertEquals(db3[0], 0);
  assertEquals(db3[1], 7);
  assertEquals(db3[3], 7);
  assertEquals(db3[4], 0);

  // CopyWithin
  const db4 = new SharedJsonBuffer<number[]>([1, 2, 3, 4, 5]);
  // Copy to index 0, elements from index 3 to end
  db4.copyWithin(0, 3); // [4, 5, 3, 4, 5]
  assertEquals(db4[0], 4);
  assertEquals(db4[1], 5);
  assertEquals(db4[2], 3);
});

// --------------------------------------------------------------------------
// 2. Accessor Methods
// These methods do not modify the original array but return a new representation.
// --------------------------------------------------------------------------

Deno.test("Array Accessors: Slice, Concat, Join, Includes, IndexOf", () => {
  const db = new SharedJsonBuffer<any>([10, 20, 30, 20, 50]);

  // Slice
  const slice = db.slice(1, 3); // [20, 30]
  assertEquals(slice.length, 2);
  assertEquals(slice[0], 20);
  // Original remains unchanged
  assertEquals(db.length, 5);

  // Concat
  const concatenated = db.concat([60, 70]);
  assertEquals(concatenated.length, 7);
  assertEquals(concatenated[5], 60);

  // Join
  const str = db.join("-");
  assertEquals(str, "10-20-30-20-50");

  // Includes
  assertEquals(db.includes(30), true);
  assertEquals(db.includes(99), false);

  // IndexOf / LastIndexOf
  assertEquals(db.indexOf(20), 1);
  assertEquals(db.lastIndexOf(20), 3);

  // New 'at' method support
  if (db.at) {
    assertEquals(db.at(-1), 50);
    assertEquals(db.at(0), 10);
  }
});

// --------------------------------------------------------------------------
// 3. Iteration Methods
// These methods loop over the array.
// --------------------------------------------------------------------------

Deno.test("Array Iteration: ForEach, Map, Filter, Reduce", () => {
  const db = new SharedJsonBuffer<number[]>([1, 2, 3, 4]);

  // ForEach
  let sum = 0;
  db.forEach((val) => sum += val);
  assertEquals(sum, 10);

  // Map
  const doubled = db.map((x) => x * 2);
  assertEquals(doubled[0], 2);
  assertEquals(doubled[3], 8);
  assert(
    Array.isArray(doubled),
    "Should return an array-like structure",
  );

  // Filter
  const evens = db.filter((x) => x % 2 === 0);
  assertEquals(evens.length, 2);
  assertEquals(evens[0], 2);
  assertEquals(evens[1], 4);

  // Reduce
  const product = db.reduce((acc, curr) => acc * curr, 1);
  assertEquals(product, 24);

  // ReduceRight
  const subRight = db.reduceRight((acc, curr) => acc - curr, 0);
  // 0 - 4 - 3 - 2 - 1 = -10
  assertEquals(subRight, -10);
});

Deno.test("Array Search: Find, FindIndex, Every, Some", () => {
  const db = new SharedJsonBuffer<{ id: number; val: string }[]>([
    { id: 1, val: "a" },
    { id: 2, val: "b" },
    { id: 3, val: "c" },
  ]);

  // Find
  const found = db.find((item) => item.id === 2);
  assertExists(found);
  assertEquals(found.val, "b");

  // FindIndex
  const idx = db.findIndex((item) => item.val === "c");
  assertEquals(idx, 2);

  // Some
  const hasA = db.some((item) => item.val === "a");
  assertEquals(hasA, true);

  // Every
  const allPositiveIds = db.every((item) => item.id > 0);
  assertEquals(allPositiveIds, true);
});

Deno.test("Array Iterator Protocols: Keys, Values, Entries", () => {
  const db = new SharedJsonBuffer<string[]>(["x", "y"]);

  // Keys
  const keys = [...db.keys()];
  assertEquals(keys, [0, 1]);

  // Values
  const values = [...db.values()];
  assertEquals(values, ["x", "y"]);

  // Entries
  const entries = [...db.entries()];
  assertEquals(entries[0], [0, "x"]);
  assertEquals(entries[1], [1, "y"]);

  // Symbol.iterator (Spread operator relies on this)
  const spread = [...db];
  assertEquals(spread, ["x", "y"]);
});

// --------------------------------------------------------------------------
// 4. Modern & Latest ECMA Standards (ES2019 - ES2023)
// --------------------------------------------------------------------------

Deno.test("Array ES2023 Change-by-Copy Methods (Immutable Updates)", () => {
  const db = new SharedJsonBuffer<number[]>([1, 4, 2, 3]);

  // toReversed()
  // Should return a new array reversed, leaving original untouched
  const reversedCopy = db.toReversed();
  assertEquals(reversedCopy, [3, 2, 4, 1]);
  assertEquals(db[0], 1); // Original must not change

  // toSorted()
  const sortedCopy = db.toSorted((a, b) => a - b);
  assertEquals(sortedCopy, [1, 2, 3, 4]);
  assertEquals(db[1], 4); // Original must not change

  // toSpliced()
  // Remove 1 element at index 1, add 8, 9
  const splicedCopy = db.toSpliced(1, 1, 8, 9);
  assertEquals(splicedCopy, [1, 8, 9, 2, 3]);
  assertEquals(db.length, 4); // Original must not change

  // with()
  // Replace element at index 2 with 99
  const withCopy = db.with(2, 99);
  assertEquals(withCopy, [1, 4, 99, 3]);
  assertEquals(db[2], 2); // Original must not change
});

Deno.test("Array ES2023 Search Methods (findLast)", () => {
  const db = new SharedJsonBuffer<number[]>([10, 20, 30, 20, 50]);

  // findLast
  const lastVal = db.findLast((x) => x > 25);
  assertEquals(lastVal, 50);

  // findLastIndex
  // There are two 20s. Accessor indexOf finds index 1.
  // findLastIndex should find index 3.
  const lastIdx = db.findLastIndex((x) => x === 20);
  assertEquals(lastIdx, 3);
});

Deno.test("Array ES2019 Flattening Methods", () => {
  // Note: Depending on SharedJsonBuffer implementation,
  // ensuring nested arrays are handled might be tricky if it strictly types <number[]>
  // Casting to any for the test case if generic allows it.
  const db = new SharedJsonBuffer([1, [2, 3], [4, [5, 6]]]);

  // flat()
  const flat1 = db.flat();
  assertEquals(flat1.length, 5); // [1, 2, 3, 4, [5, 6]]
  assertEquals(flat1[1], 2);

  const flatDeep = db.flat(2);
  assertEquals(flatDeep.length, 6); // [1, 2, 3, 4, 5, 6]

  // flatMap()
  const dbNums = new SharedJsonBuffer<number[]>([1, 2, 3]);
  const flatMapped = dbNums.flatMap((x) => [x, x * 10]);
  assertEquals(flatMapped, [1, 10, 2, 20, 3, 30]);
});

Deno.test("Array String Conversion", () => {
  const db = new SharedJsonBuffer<string[]>(["a", "b"]);

  assertEquals(db.toString(), "a,b");
  // toLocaleString behaves similarly to toString for simple strings,
  // but good to ensure it doesn't throw.
  assertExists(db.toLocaleString());
});
