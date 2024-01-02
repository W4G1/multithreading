/** @type {import('../src/index.ts').threaded} */
const threaded = require("../dist/index.js").threaded;
/** @type {import('../src/index.ts').$unclaim}*/
const $unclaim = require("../dist/index.js").$unclaim;
/** @type {import('../src/index.ts').$claim}*/
const $claim = require("../dist/index.js").$claim;

describe("Edge case tests", () => {
  test("No yield", async () => {
    const add = threaded(function* (a, b) {
      return a + b;
    });

    expect(await add(5, 10)).toBe(15);

    add.dispose();
  });

  test("Unused dependencies", async () => {
    const user = {
      name: "john",
    };

    const add = threaded(function* (a, b) {
      yield user;
      return a + b;
    });

    expect(await add(5, 10)).toBe(15);

    add.dispose();
  });

  test("Empty function", async () => {
    const add = threaded(function* () {});

    expect(await add()).toBe(undefined);

    add.dispose();
  });

  test("No params defined but still invoking with params", async () => {
    const add = threaded(function* () {
      return true;
    });

    expect(await add(1, 2, 3)).toBe(true);

    add.dispose();
  });

  test("Params defined but not invoking with params", async () => {
    const add = threaded(function* (a, b) {
      return true;
    });

    expect(await add()).toBe(true);

    add.dispose();
  });

  test("No return", async () => {
    const add = threaded(function* (a, b) {
      a + b;
    });

    expect(await add(1, 2)).toBe(undefined);

    add.dispose();
  });

  test("No return but yielding", async () => {
    const user = {
      name: "john",
    };

    const add = threaded(function* () {
      yield user;
    });

    expect(await add()).toBe(undefined);

    add.dispose();
  });
});
