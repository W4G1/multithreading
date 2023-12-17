# multithreading

Multithreading is a tiny runtime that allows you to execute functions on separate threads. It is designed to be as simple and fast as possible, and to be used in a similar way to regular functions.

With a minified size of only 3.8kb, it has first class support for [Node.js](https://nodejs.org/), [Deno](https://deno.land/) and the [browser](https://caniuse.com/#feat=webworkers). It can also be used with any framework or library such as [React](https://reactjs.org/), [Vue](https://vuejs.org/) or [Svelte](https://svelte.dev/).

Depending on the environment, it uses [Worker Threads](https://nodejs.org/api/worker_threads.html) or [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API). In addition to [ES6 generators](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*) to make multithreading as simple as possible.


## Installation

```bash
npm install multithreading
```

## Usage

#### Minimal example

```js
import { threaded } from "multithreading";

const add = threaded(function* (a, b) {
  return a + b;
});

console.log(await add(5, 10)); // 15
```
The `add` function is executed on a separate thread, and the result is returned to the main thread when the function is done executing. Multiple invocations will automatically be executed in parallel on separate threads.

#### Example with shared state

```js
import { threaded, $claim, $unclaim } from "multithreading";

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

console.log(user.balance); // 15
```
This example shows how to use a shared state across multiple threads. It introduces the concepts of claiming and unclaiming write access using `$claim` and `$unclaim`. This is to ensure that only one thread can write to a shared state at a time.

> Always `$unclaim()` a shared state after use, otherwise the write lock will never be released and other threads that want to write to this state will be blocked indefinitely.

The `yield` statement is used to specify external dependencies, and must be defined at the top of the function.

#### Example with external functions

```js
import { threaded, $claim, $unclaim } from "multithreading";

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
  add(5),
  add(10),
]);

console.log(user.balance); // 15
```
