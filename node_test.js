"use strict";

const { thread, shared } = require("./dist/bundle.cjs");

function add(a, b) {
  return a + b;
}

function log(...args) {
  console.log(...args);
}

function main() {
  let counter = shared(0);

  const count = thread(function* (amount) {
    yield { counter, add, log };

    log("Requesting counter..");
    // Claim counter
    yield counter;
    log("Counter claimed!");
    
    // Thread now has ownership over counter and is
    // guaranteed not to change by other threads
    counter.value = add(counter.value, amount);
    
    // Unclaim counter
    yield* counter;
  });

  setTimeout(() => count(5), 100);
  // setTimeout(() => count(5), 200);
  // setTimeout(() => count(5), 300);
}

main();
