/** @type {import('../src/index.ts').threaded} */
const threaded = require("../dist/index.js").threaded;
/** @type {import('../src/index.ts').$unclaim}*/
const $unclaim = require("../dist/index.js").$unclaim;
/** @type {import('../src/index.ts').$claim}*/
const $claim = require("../dist/index.js").$claim;

const users = ["john", "jane", "joe"];
const accounts = [{ user: "john" }, { user: "jane" }, { user: "joe" }];

describe("Import tests", () => {
  test("Single import", async () => {
    const fn = threaded(function* () {
      const { v4 } = yield "uuid";
      return v4();
    });

    const result = await fn();

    expect(result).toHaveLength(36);

    fn.dispose();
  });

  test("Multiple import", async () => {
    const fn = threaded(function* () {
      const { v4 } = yield "uuid";
      const { v1 } = yield "uuid";
      return {
        v4: v4(),
        v1: v1(),
      };
    });

    const result = await fn();

    expect(result).toHaveProperty("v4");
    expect(result).toHaveProperty("v1");
    expect(result.v4).toHaveLength(36);
    expect(result.v1).toHaveLength(36);

    fn.dispose();
  });

  test("Multiple import with single variable first", async () => {
    const fn = threaded(function* () {
      yield users;
      const { v4 } = yield "uuid";
      const { v1 } = yield "uuid";
      return {
        users,
        v4: v4(),
        v1: v1(),
      };
    });

    const result = await fn();

    expect(result.users).toHaveLength(3);
    expect(result).toHaveProperty("v4");
    expect(result).toHaveProperty("v1");
    expect(result.v4).toHaveLength(36);
    expect(result.v1).toHaveLength(36);

    fn.dispose();
  });

  test("Multiple import with single variable in the middle", async () => {
    const fn = threaded(function* () {
      const { v4 } = yield "uuid";
      yield users;
      const { v1 } = yield "uuid";
      return {
        users,
        v4: v4(),
        v1: v1(),
      };
    });

    const result = await fn();

    expect(result.users).toHaveLength(3);
    expect(result).toHaveProperty("v4");
    expect(result).toHaveProperty("v1");
    expect(result.v4).toHaveLength(36);
    expect(result.v1).toHaveLength(36);

    fn.dispose();
  });

  test("Multiple import with single variable last", async () => {
    const fn = threaded(function* () {
      const { v4 } = yield "uuid";
      const { v1 } = yield "uuid";
      yield users;
      return {
        users,
        v4: v4(),
        v1: v1(),
      };
    });

    const result = await fn();

    expect(result.users).toHaveLength(3);
    expect(result).toHaveProperty("v4");
    expect(result).toHaveProperty("v1");
    expect(result.v4).toHaveLength(36);
    expect(result.v1).toHaveLength(36);

    fn.dispose();
  });

  test("Multiple import with multiple variables first", async () => {
    const fn = threaded(function* () {
      yield users;
      yield accounts;
      const { v4 } = yield "uuid";
      const { v1 } = yield "uuid";
      return {
        users,
        accounts,
        v4: v4(),
        v1: v1(),
      };
    });

    const result = await fn();

    expect(result.users).toHaveLength(3);
    expect(result.accounts).toHaveLength(3);
    expect(result).toHaveProperty("v4");
    expect(result).toHaveProperty("v1");
    expect(result.v4).toHaveLength(36);
    expect(result.v1).toHaveLength(36);

    fn.dispose();
  });

  test("Multiple import with multiple variables in the middle", async () => {
    const fn = threaded(function* () {
      const { v4 } = yield "uuid";
      yield users;
      yield accounts;
      const { v1 } = yield "uuid";
      return {
        users,
        accounts,
        v4: v4(),
        v1: v1(),
      };
    });

    const result = await fn();

    expect(result.users).toHaveLength(3);
    expect(result.accounts).toHaveLength(3);
    expect(result).toHaveProperty("v4");
    expect(result).toHaveProperty("v1");
    expect(result.v4).toHaveLength(36);
    expect(result.v1).toHaveLength(36);

    fn.dispose();
  });

  test("Multiple import with multiple variables last", async () => {
    const fn = threaded(function* () {
      const { v4 } = yield "uuid";
      const { v1 } = yield "uuid";
      yield users;
      yield accounts;
      return {
        users,
        accounts,
        v4: v4(),
        v1: v1(),
      };
    });

    const result = await fn();

    expect(result.users).toHaveLength(3);
    expect(result.accounts).toHaveLength(3);
    expect(result).toHaveProperty("v4");
    expect(result).toHaveProperty("v1");
    expect(result.v4).toHaveLength(36);
    expect(result.v1).toHaveLength(36);

    fn.dispose();
  });

  test("Multiple import with multiple variables spread out variant 1", async () => {
    const fn = threaded(function* () {
      const { v4 } = yield "uuid";
      yield users;
      const { v1 } = yield "uuid";
      yield accounts;
      return {
        users,
        accounts,
        v4: v4(),
        v1: v1(),
      };
    });

    const result = await fn();

    expect(result.users).toHaveLength(3);
    expect(result.accounts).toHaveLength(3);
    expect(result).toHaveProperty("v4");
    expect(result).toHaveProperty("v1");
    expect(result.v4).toHaveLength(36);
    expect(result.v1).toHaveLength(36);

    fn.dispose();
  });

  test("Multiple import with multiple variables spread out variant 2", async () => {
    const fn = threaded(function* () {
      yield users;
      const { v4 } = yield "uuid";
      yield accounts;
      const { v1 } = yield "uuid";
      return {
        users,
        accounts,
        v4: v4(),
        v1: v1(),
      };
    });

    const result = await fn();

    expect(result.users).toHaveLength(3);
    expect(result.accounts).toHaveLength(3);
    expect(result).toHaveProperty("v4");
    expect(result).toHaveProperty("v1");
    expect(result.v4).toHaveLength(36);
    expect(result.v1).toHaveLength(36);

    fn.dispose();
  });
});
