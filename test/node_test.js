"use strict";

/** @type {import('../src/index.ts').threaded} */
const threaded = require("../dist/cjs/index.js").threaded;
/** @type {import('../src/index.ts').$unclaim}*/
const $unclaim = require("../dist/cjs/index.js").$unclaim;
/** @type {import('../src/index.ts').$claim}*/
const $claim = require("../dist/cjs/index.js").$claim;

function add(a, b) {
  return a + b;
}

async function main() {
  const user = {
    name: "john",
    balance: 100,
  };

  const addBalance = threaded(async function* (amount) {
    yield { user, add };

    await $claim(user);
    
    // Thread now has ownership over user and is
    // guaranteed not to change by other threads
    user.balance = add(user.balance, amount);

    $unclaim(user);

    return user;
  });


  await Promise.all([
    addBalance(10),
    addBalance(10),
    addBalance(10),
    addBalance(10),
    addBalance(10),
    addBalance(10),
    addBalance(10),
    addBalance(10),
    addBalance(10),
    addBalance(10),
  ]);

  console.assert(user.balance === 200, "Balance should be 200");
  
  console.log("Result in main:", user);
}

main();
