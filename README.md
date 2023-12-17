# multithreading

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

#### Example with shared state
```js
import { threaded, $claim, $unclaim } from "multithreading";

const user = {
  name: "john",
  balance: 0,
};

const add = threaded(async function* (amount) {
  yield { user }; // Specify dependencies

  await $claim(user); // Claim ownership over user

  user.balance += amount;

  $unclaim(user); // Release ownership
});

await Promise.all([
  add(5),
  add(10),
]);

console.log(user.balance); // 15
```

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
