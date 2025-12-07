import {
  assert,
  assertEquals,
  assertExists,
  assertNotEquals,
} from "@std/assert";
import { SharedJsonBuffer } from "../lib/json_buffer.ts";

// --------------------------------------------------------------------------
// 1. Basic CRUD (Create, Read, Update, Delete)
// These are the core Proxy traps for getting, setting, and deleting properties.
// --------------------------------------------------------------------------

Deno.test("Object CRUD: Property Access and Assignment", () => {
  const db = new SharedJsonBuffer<{ name: string; age: number; city?: string }>(
    {
      name: "Alice",
      age: 25,
    },
  );

  // Read
  assertEquals(db.name, "Alice");
  assertEquals(db["age"], 25);

  // Update (Modification)
  db.age = 26;
  assertEquals(db.age, 26);
  assertEquals(db["age"], 26);

  // Create (New Property)
  db.city = "New York";
  assertEquals(db.city, "New York");
  assertEquals(db["city"], "New York");

  // Type cohesion check (if applicable to your buffer implementation)
  // db.age = "27" as any; // Depending on implementation, might throw or cast
});

Deno.test("Object CRUD: Deletion and Existence", () => {
  const db = new SharedJsonBuffer<{ a: number; b: number; c: number }>({
    a: 1,
    b: 2,
    c: 3,
  });

  // 'in' operator
  assert("a" in db);
  assertEquals("z" in db, false);

  // Delete operator
  // @ts-ignore
  const deleteResult = delete db.b;
  assertEquals(deleteResult, true); // delete returns true if successful

  // Verify deletion
  assertEquals(db.b, undefined);
  assert(!("b" in db));
  assertEquals(Object.keys(db).length, 2);
});

// --------------------------------------------------------------------------
// 2. Reflection & Iteration (Keys, Values, Entries)
// These tests check the `ownKeys` proxy trap and enumeration order.
// --------------------------------------------------------------------------

Deno.test("Object Reflection: Keys, Values, Entries", () => {
  const db = new SharedJsonBuffer<{ x: number; y: number; z: number }>({
    x: 10,
    y: 20,
    z: 30,
  });

  // Object.keys()
  const keys = Object.keys(db);
  assertEquals(keys.length, 3);
  assert(keys.includes("x"));
  assert(keys.includes("y"));
  assert(keys.includes("z"));

  // Object.values()
  const values = Object.values(db);
  assertEquals(values.length, 3);
  assert(values.includes(10));
  assert(values.includes(30));

  // Object.entries()
  const entries = Object.entries(db);
  assertEquals(entries.length, 3);
  // Check strict equality of first entry structure
  assertEquals(entries[0]?.length, 2);
});

Deno.test("Object Iteration: for...in loop", () => {
  const db = new SharedJsonBuffer<{ a: number; b: number }>({ a: 1, b: 2 });
  const keysFound: string[] = [];

  for (const key in db) {
    keysFound.push(key);
  }

  // Verify we iterated over all keys
  assert(keysFound.includes("a"));
  assert(keysFound.includes("b"));
  assertEquals(keysFound.length, 2);
});

// --------------------------------------------------------------------------
// 3. Merging, Copying, and Spread Syntax
// These rely on keys and getters working correctly in tandem.
// --------------------------------------------------------------------------

Deno.test("Object Copying: Object.assign", () => {
  const db = new SharedJsonBuffer<{ a: number; b: number }>({ a: 1, b: 2 });

  // Merge INTO the shared buffer
  // This effectively calls set() for every property in the source
  Object.assign(db, { b: 3, c: 4 });

  assertEquals(db.a, 1);
  assertEquals(db.b, 3); // Updated
  // @ts-ignore: dynamic property test
  assertEquals(db.c, 4); // Created

  // Merge FROM the shared buffer
  const target = {};
  Object.assign(target, db);
  assertEquals(target, { a: 1, b: 3, c: 4 });
});

Deno.test("Object Copying: Spread Syntax", () => {
  const db = new SharedJsonBuffer({ foo: "bar", baz: "qux" });

  // Shallow copy using spread
  const plainObj = { ...db };

  assertEquals(plainObj.foo, "bar");
  assertEquals(plainObj.baz, "qux");

  // Ensure it is a genuine copy, not a reference
  // @ts-ignore: testing mutation independence
  plainObj.foo = "changed";
  assertEquals(db.foo, "bar");
});

Deno.test("Object Transformation: Object.fromEntries", () => {
  const db = new SharedJsonBuffer({ id: 1, status: "active" });

  const entries = Object.entries(db);
  const reconstructed = Object.fromEntries(entries);

  assertEquals(reconstructed["id"], 1);
  assertEquals(reconstructed["status"], "active");
});

// --------------------------------------------------------------------------
// 4. Property Descriptors & Definition
// Advanced tests for defineProperty and getOwnPropertyDescriptor.
// --------------------------------------------------------------------------

Deno.test("Object Descriptors: getOwnPropertyDescriptor", () => {
  const db = new SharedJsonBuffer({ id: 100 });

  const desc = Object.getOwnPropertyDescriptor(db, "id");

  assertExists(desc);
  assertEquals(desc.value, 100);
  assertEquals(desc.writable, true);
  assertEquals(desc.enumerable, true);
  assertEquals(desc.configurable, true);
});

Deno.test("Object Descriptors: defineProperty", () => {
  const db = new SharedJsonBuffer<{ prop?: string }>({});

  // Define a new property via defineProperty
  Object.defineProperty(db, "prop", {
    value: "hello",
    writable: true,
    enumerable: true,
    configurable: true,
  });

  assertEquals(db.prop, "hello");

  // Verify it appears in keys (enumerable check)
  assertEquals(Object.keys(db).includes("prop"), true);
});

Deno.test("Object Comparison: Object.is", () => {
  const db = new SharedJsonBuffer({ val: NaN });

  assertEquals(db.val, NaN);

  // Object.is handles NaN correctly
  assert(Object.is(db.val, NaN));
});

// --------------------------------------------------------------------------
// 5. Nested Objects & Modern Accessors
// --------------------------------------------------------------------------

Deno.test("Object Nested: Deep Access and Mutation", () => {
  const db = new SharedJsonBuffer<{
    user: {
      details: {
        age: number;
      };
    };
  }>({
    user: {
      details: {
        age: 30,
      },
    },
  });

  // Deep Read
  assertEquals(db.user.details.age, 30);

  // Deep Write
  db.user.details.age = 31;
  assertEquals(db.user.details.age, 31);

  // Replace entire subtree
  db.user = { details: { age: 100 } };
  assertEquals(db.user.details.age, 100);
});

Deno.test("Object Utilities: hasOwn / hasOwnProperty", () => {
  const db = new SharedJsonBuffer({ key: "value" });

  // Legacy
  assertEquals(Object.prototype.hasOwnProperty.call(db, "key"), true);
  assertEquals(Object.prototype.hasOwnProperty.call(db, "missing"), false);

  // Modern (ES2022)
  if (Object.hasOwn) {
    assertEquals(Object.hasOwn(db, "key"), true);
    assertEquals(Object.hasOwn(db, "missing"), false);
  }
});
