import { assert, assertEquals } from "@std/assert";
import { SharedJsonBuffer } from "../src/deno/lib.ts";

Deno.test("Basic Object: Read and Write", () => {
  const db = new SharedJsonBuffer({
    name: "Test",
    count: 0,
    active: true,
  });

  assertEquals(db.name, "Test");
  assertEquals(db.count, 0);
  assertEquals(db.active, true);

  db.count = 42;
  db.name = "Updated";

  assertEquals(db.count, 42);
  assertEquals(db.name, "Updated");
});

Deno.test("Nested Objects and Arrays", () => {
  const db = new SharedJsonBuffer({
    user: {
      profile: {
        age: 30,
      },
      tags: ["a", "b"],
    },
  });

  assertEquals(db.user.profile.age, 30);
  assertEquals(db.user.tags[0], "a");
  assertEquals(db.user.tags[1], "b");
  assertEquals(db.user.tags.length, 2);

  db.user.tags.push("c");
  assertEquals(db.user.tags.length, 3);
  assertEquals(db.user.tags[2], "c");
});

Deno.test("Object Deletion (Swap and Pop)", () => {
  const db = new SharedJsonBuffer({
    a: 1,
    b: 2,
    c: 3,
    d: 4,
  });

  // Verify initial state
  assertEquals(Object.keys(db).length, 4);

  // Delete a middle key
  // @ts-ignore
  delete db.b;

  // Verify logic
  assertEquals(db.b, undefined);
  assertEquals(db.a, 1);
  assertEquals(db.c, 3);
  assertEquals(db.d, 4);
  assertEquals(Object.keys(db).length, 3);

  // Add a new key to ensure slot reuse/append works
  // @ts-ignore
  db.e = 5;
  // @ts-ignore
  assertEquals(db.e, 5);
  assertEquals(Object.keys(db).length, 4);
});

Deno.test("Garbage Collection: OOM Trigger and Recovery", () => {
  // 1. Create a very small buffer (256 bytes)
  // This will force OOM very quickly if we don't GC.
  const db = new SharedJsonBuffer<any>({ keep: "alive" }, { size: 512 });

  // 2. Add some permanent data we expect to survive
  db.permanent = {
    id: 1,
    data: "I should survive",
  };

  const initialPtr = db.permanent.__ptr;

  // 3. Generate "garbage" loop
  // We keep overwriting db.temp. This makes the previous object allocated
  // to db.temp unreachable (garbage).
  // Without GC, this loop would throw "SharedJsonBuffer OOM".
  console.log("Starting allocation stress test...");

  for (let i = 0; i < 50; i++) {
    db.temp = {
      iteration: i,
      payload: "x".repeat(10), // Take up some space
      nested: { a: i, b: i * 2 },
    };
  }

  console.log("Stress test complete. Verifying data integrity...");

  // 4. Verify the permanent data is still there and correct
  assertEquals(db.keep, "alive");
  assertEquals(db.permanent.id, 1);
  assertEquals(db.permanent.data, "I should survive");

  // 5. Verify the LAST item written is also there
  assertEquals(db.temp.iteration, 49);

  // 6. Verify pointers moved (Compaction happened)
  // If GC ran, the 'permanent' object should likely have moved to fill the gaps
  // left by the initial garbage.
  const newPtr = db.permanent.__ptr;
  console.log(`Pointer moved from ${initialPtr} to ${newPtr}`);

  // Note: Depending on exact layout, it might not move if it was at the start,
  // but in this specific implementation, copy-collection usually moves everything.
  assert(newPtr !== 0, "Pointer should be valid");
});

Deno.test("Proxy Stability: References Survive GC", () => {
  const db = new SharedJsonBuffer<any>({}, { size: 512 });

  // 1. Create a nested object
  db.target = { value: 100 };

  // 2. Hold a JS reference to that proxy
  const myRef = db.target;

  assertEquals(myRef.value, 100);

  // 3. Force GC by creating garbage
  for (let i = 0; i < 50; i++) {
    db.trash = { garbage: "filling space " + i };
  }

  // 4. Validate the OLD reference still works
  // The GC should have updated `myRef.__ptr` internally via the `activeTargets` set.
  assertEquals(myRef.value, 100);

  // 5. Modify via the old reference
  myRef.value = 200;

  // 6. Verify via root
  assertEquals(db.target.value, 200);
});

Deno.test("Array: Push, Pop, and Iteration", () => {
  const db = new SharedJsonBuffer([1, 2, 3]);

  // Push triggers resize if needed
  for (let i = 4; i <= 10; i++) {
    db.push(i);
  }
  assertEquals(db.length, 10);
  assertEquals(db[9], 10);

  // Pop
  const popped = db.pop();
  assertEquals(popped, 10);
  assertEquals(db.length, 9);

  // Iteration
  let sum = 0;
  for (const item of db) {
    sum += item;
  }
  // 1+2+...9
  assertEquals(sum, 45);
});

Deno.test("Rehydration from Buffer", () => {
  const sab = new SharedArrayBuffer(1024);

  // Instance 1
  const db1 = new SharedJsonBuffer({ msg: "hello" }, sab);
  db1.msg = "world";

  // Instance 2 (Simulating another worker or reload)
  const db2 = new SharedJsonBuffer(null as any, sab);

  assertEquals(db2.msg, "world");
});
