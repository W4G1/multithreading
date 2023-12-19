<div align="center">

[![Multithreading Banner](https://github.com/W4G1/multithreading/assets/38042257/a4eb6cae-1e78-493f-aeaa-75b6aa50edd4)](https://multithreading.io)

[![License](https://img.shields.io/github/license/W4G1/multithreading)](https://github.com/W4G1/multithreading/blob/main/LICENSE.md)
[![Downloads](https://img.shields.io/npm/dw/multithreading?color=%238956FF)](https://www.npmjs.com/package/multithreading)
[![NPM version](https://img.shields.io/npm/v/multithreading)](https://www.npmjs.com/package/multithreading?activeTab=versions)
[![GitHub Repo stars](https://img.shields.io/github/stars/W4G1/multithreading?logo=github&label=Star&labelColor=rgb(26%2C%2030%2C%2035)&color=rgb(13%2C%2017%2C%2023))](https://github.com/W4G1/multithreading)
[![Node.js CI](https://github.com/W4G1/multithreading/actions/workflows/node.js.yml/badge.svg)](https://github.com/W4G1/multithreading/actions/workflows/node.js.yml)

</div>

# multithreading

Multithreading is a tiny runtime that allows you to execute JavaScript functions on separate threads. It is designed to be as simple and fast as possible, and to be used in a similar way to regular functions.

With a minified size of only 4.5kb, it has first class support for [Node.js](https://nodejs.org/), [Deno](https://deno.com/) and the [browser](https://caniuse.com/?search=webworkers). It can also be used with any framework or library such as [React](https://react.dev/), [Vue](https://vuejs.org/) or [Svelte](https://svelte.dev/).

Depending on the environment, it uses [Worker Threads](https://nodejs.org/api/worker_threads.html) or [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Worker). In addition to [ES6 generators](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/function*) to make multithreading as simple as possible.

## Installation

```bash
npm install multithreading
```

## Usage

#### Basic example

```js
import { threaded } from "multithreading";

const add = threaded(function* (a, b) {
  return a + b;
});

console.log(await add(5, 10)); // 15
```
The `add` function is executed on a separate thread, and the result is returned to the main thread when the function is done executing. Consecutive invocations will be automatically executed in parallel on separate threads.

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
  addBalance(5),
  addBalance(10),
]);

console.log(user.balance); // 15
```
In this example, the `add` function is used within the multithreaded `addBalance` function. The `yield` statement is used to declare external dependencies, ensuring that the required functions and data are available to the threaded function.

As with previous examples, the shared state is managed using `$claim` and `$unclaim` to guarantee proper synchronization and prevent data conflicts.

> External functions like `add` cannot have external dependencies themselves. All variables and functions used by an external function must be declared within the function itself.

### Using imports from external packages

When using external modules, you can dynamically import them by using the `import()` statement. This is useful when you want to use other packages within a threaded function.

```js
import { threaded } from "multithreading";

const getId = threaded(async function* () {
  yield {};

  const uuid = await import("uuid"); // Import other package

  return uuid.v4();
}

console.log(await getId()); // 1a107623-3052-4f61-aca9-9d9388fb2d81
```

### Usage with Svelte

Svelte disallows imports whose name start with a `$`. To use multithreading with Svelte, you can also retrieve `$claim` and `$unclaim` directly from the `yield` statement.

```js
import { threaded } from "multithreading";

const fn = threaded(function* () {
  const { $claim, $unclaim } = yield {};

  // ...
}
```