/** @type {import('../src/index.ts').threaded} */
const threaded = require("../dist/cjs/index.cjs").threaded;
/** @type {import('../src/index.ts').$unclaim}*/
const $unclaim = require("../dist/cjs/index.cjs").$unclaim;
/** @type {import('../src/index.ts').$claim}*/
const $claim = require("../dist/cjs/index.cjs").$claim;

describe("Example tests", () => {
  test("Minimal example", async () => {
    const add = threaded(function* (a, b) {
      return a + b;
    });

    expect(await add(5, 10)).toBe(15);

    add.dispose();
  });

  test("Example with shared state", async () => {
    const user = {
      name: "john",
      balance: 0,
    };
    
    const add = threaded(async function* (amount) {
      yield { user }; // Specify dependencies
    
      await $claim(user); // Wait for write lock
    
      user.balance += amount;
    
      $unclaim(user); // Release write lock
    });
    
    await Promise.all([
      add(5),
      add(10),
    ]);

    expect(user.balance).toBe(15);

    add.dispose();
  });

  test("Example with external functions", async () => {
    // Some external function
    function add (a, b) {
      return a + b;
    }

    const user = {
      name: "john",
      balance: 0,
    };

    const addBalance = threaded(async function* (amount) {
      yield { user, add }; // Add to dependencies

      await $claim(user);

      user.balance = add(user.balance, amount);

      $unclaim(user);
    });


    await Promise.all([
      addBalance(5),
      addBalance(10),
    ]);

    expect(user.balance).toBe(15);

    addBalance.dispose();
  });
});
