<div align="center">

[![License](https://img.shields.io/github/license/W4G1/multithreading)](https://github.com/W4G1/multithreading/blob/main/LICENSE.md)
[![Downloads](https://img.shields.io/npm/dw/multithreading?color=%238956FF)](https://www.npmjs.com/package/multithreading)
[![NPM version](https://img.shields.io/npm/v/multithreading)](https://www.npmjs.com/package/multithreading?activeTab=versions)
[![GitHub Repo stars](https://img.shields.io/github/stars/W4G1/multithreading?logo=github&label=Star&labelColor=rgb(26%2C%2030%2C%2035)&color=rgb(13%2C%2017%2C%2023))](https://github.com/W4G1/multithreading)

</div>

# Multithreading.js

**Multithreading** is a TypeScript library that brings robust, Rust-inspired concurrency primitives to the JavaScript ecosystem. It provides a thread-pool architecture, strict memory safety semantics, and synchronization primitives like Mutexes, Read-Write Locks, and Condition Variables.

This library is designed to abstract away the complexity of managing `WebWorkers`, serialization, and `SharedArrayBuffer` complexities, allowing developers to write multi-threaded code that looks and feels like standard asynchronous JavaScript.

## Installation

```bash
npm install multithreading
```

## Core Concepts

JavaScript is traditionally single-threaded. To achieve true parallelism, this library uses Web Workers. However, unlike standard Workers, this library offers:

1.  **Managed Worker Pool**: Automatically manages a pool of threads based on hardware concurrency.
2.  **Shared Memory Primitives**: Tools to safely share state between threads without race conditions.
3.  **Scoped Imports**: Support for importing external modules and relative files directly within worker tasks.
4.  **Move Semantics**: Explicit data ownership transfer to prevent cloning overhead.

## Quick Start

The entry point for most operations is the `spawn` function. This submits a task to the thread pool and returns a handle to await the result.

```typescript
import { spawn } from "multithreading";

// Spawn a task on a background thread
const handle = spawn(() => {
  // This code runs in a separate worker
  const result = Math.random();
  return result;
});

// Wait for the result
const result = await handle.join();

if (result.ok) {
  console.log("Result:", result.value); // 0.3378467071314606
} else {
  console.error("Worker error:", result.error);
}
```

-----

## Passing Data: The `move()` Function

Because Web Workers run in a completely isolated context, functions passed to `spawn` cannot capture variables from their outer scope (closures). If you attempt to use a variable inside the worker that was defined outside of it, the code will fail.

To get data from your main thread into the worker, you have to use the `move()` function.

The `move` function accepts variadic arguments. These arguments are passed to the worker function in the order they were provided. Despite the name, `move` handles data in two ways:

1.  **Transferable Objects (e.g., `ArrayBuffer`, `Uint32Array`):** These are "moved" (zero-copy). Ownership transfers to the worker, and the original becomes unusable in the main thread.
2.  **Non-Transferable Objects (e.g., JSON, numbers, strings):** These are cloned via structured cloning. They remain usable in the main thread.

<!-- end list -->

```typescript
import { spawn, move } from "multithreading";

const largeData = new Uint8Array(1024 * 1024 * 10); // 10MB
const metaData = { id: 1 };

// We pass arguments as a comma-separated list.
// 'largeData' is MOVED (zero-copy) because it is transferable.
// 'metaData' is CLONED because it is a standard object.
const handle = spawn(move(largeData, metaData), (data, meta) => {
  console.log("Processing ID:", meta.id);
  return data.byteLength;
});

await handle.join();
```

-----

## SharedJsonBuffer: Sharing Complex Objects

`SharedJsonBuffer` enables Mutex-protected shared memory for JSON objects, eliminating the overhead of `postMessage` data copying. Unlike standard buffers, it handles serialization automatically. It supports partial updates, re-serializing only changed bytes rather than the entire object tree for high-performance state synchronization.

```typescript
import { move, Mutex, SharedJsonBuffer, spawn } from "./lib/lib.ts";

const sharedState = new Mutex(new SharedJsonBuffer({
  score: 0,
  players: ["Main Thread"],
  level: {
    id: 1,
    title: "Start",
  },
}));

await spawn(move(sharedState), async (lock) => {
  using guard = await lock.acquire();

  const state = guard.value;

  console.log(`Current Score: ${state.score}`);

  // Modify the data
  state.score += 100;
  state.players.push("Worker1");

  // End of scope: Lock is automatically released here
}).join();

// Verify on main thread
using guard = await sharedState.acquire();

console.log(guard.value); // { score: 100, players: ["Main Thread", "Worker1"], ... }
```

-----

## Synchronization Primitives

When multiple threads access shared memory (via `SharedArrayBuffer`), race conditions occur. This library provides primitives to synchronize access safely.

**Best Practice:** It is highly recommended to use the asynchronous methods (e.g., `acquire`, `read`, `write`, `wait`) rather than their synchronous counterparts. Synchronous blocking halts the entire Worker thread, potentially pausing other tasks sharing that worker.

### 1\. Mutex (Mutual Exclusion)

A `Mutex` ensures that only one thread can access a specific piece of data at a time.

#### Option A: Automatic Management (Recommended)

This library leverages the [Explicit Resource Management](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using) proposal (`using` keyword). When you acquire a lock, it returns a guard. When that guard goes out of scope, the lock is automatically released.

```typescript
import { spawn, move, Mutex, SharedArrayBuffer } from "multithreading";

const buffer = new SharedArrayBuffer(4);
const counterMutex = new Mutex(new Int32Array(buffer));

spawn(move(counterMutex), async (mutex) => {
  // 'using' automatically calls dispose() at the end of the block
  // awaiting acquire() ensures we don't block the thread while waiting
  using guard = await mutex.acquire();
  
  // Critical Section
  guard.value[0]++;
  
  // End of scope: Lock is automatically released here
});
```

#### Option B: Manual Management (Bun / Standard JS)

If you are using **Bun** (which currently has transpilation issues with `using` logic in some versions) or prefer standard JavaScript syntax, you must manually release the lock using `drop()`. Always use a `try...finally` block to ensure the lock is released even if an error occurs.

```typescript
import { spawn, move, Mutex, SharedArrayBuffer } from "multithreading";

const buffer = new SharedArrayBuffer(4);
const counterMutex = new Mutex(new Int32Array(buffer));

spawn(move(counterMutex), async (mutex) => {
  // Note that we have to import drop here, otherwise it wouldn't be available
  const { drop } = await import("multithreading");

  // 1. Acquire the lock manually
  const guard = await mutex.acquire();

  try {
    // 2. Critical Section
    guard.value[0]++;
  } finally {
    // 3. Explicitly release the lock
    drop(guard);
  }
});
```

### 2\. RwLock (Read-Write Lock)

A `RwLock` is optimized for scenarios where data is read often but written rarely. It allows **multiple** simultaneous readers but only **one** writer.

```typescript
import { spawn, move, RwLock, SharedArrayBuffer } from "multithreading";

const lock = new RwLock(new Int32Array(new SharedArrayBuffer(4)));

// Spawning a Writer
spawn(move(lock), async (l) => {
  // Blocks until all readers are finished (asynchronously)
  using guard = await l.write(); 
  guard.value[0] = 42;
});

// Spawning Readers
spawn(move(lock), async (l) => {
  // Multiple threads can hold this lock simultaneously
  using guard = await l.read(); 
  console.log(guard.value[0]);
});
```

### 3\. Semaphore

A `Semaphore` limits the number of threads that can access a resource simultaneously. Unlike a Mutex (which allows exactly 1 owner), a Semaphore allows `N` owners. This is essential for rate limiting, managing connection pools, or bounding concurrency.

```typescript
import { spawn, move, Semaphore } from "multithreading";

// Initialize with 3 permits (allowing 3 concurrent tasks)
const semaphore = new Semaphore(3);

for (let i = 0; i < 10; i++) {
  spawn(move(semaphore), async (sem) => {
    console.log("Waiting for slot...");
    
    // Will wait (async) if 3 threads are already working
    using _ = await sem.acquire(); 
    
    console.log("Acquired slot! Working...");

    await new Promise(r => setTimeout(r, 1000));
    
    // Guard is disposed automatically, releasing the permit for the next thread
  });
}
```

#### Manual Release

Like the Mutex, if you cannot use the `using` keyword, you can manually manage the lifecycle.

```typescript
spawn(move(semaphore), async (sem) => {
  const { drop } = await import("multithreading");
  // Acquire 2 permits at once
  const guard = await sem.acquire(2);
  
  try {
    // Critical Section
  } finally {
    // Release the 2 permits
    drop(guard);
  }
});
```

### 4\. Condvar (Condition Variable)

A `Condvar` allows threads to wait for a specific condition to become true. It saves CPU resources by putting the task to sleep until it is notified, rather than constantly checking a value.

```typescript
import { spawn, move, Mutex, Condvar, SharedArrayBuffer } from "multithreading";

const mutex = new Mutex(new Int32Array(new SharedArrayBuffer(4)));
const cv = new Condvar();

spawn(move(mutex, cv), async (lock, cond) => {
  using guard = await lock.acquire();
  
  // Wait until value is not 0
  while (guard.value[0] === 0) {
    // wait() unlocks the mutex, waits for notification, then re-locks.
    await cond.wait(guard);
  }
  
  console.log("Received signal, value is:", guard.value[0]);
});
```

-----

## Importing Modules in Workers

One of the most difficult aspects of Web Workers is handling imports. This library handles this automatically, enabling you to use dynamic `await import()` calls inside your spawned functions.

You can import:

1.  **External Libraries:** Packages from npm/CDN (depending on environment).
2.  **Relative Files:** Files relative to the file calling `spawn`.

**Note:** The function passed to `spawn` must be self-contained or explicitly import what it needs. It cannot access variables from the outer scope (closures) unless they are passed via `move()`.

### Example: Importing Relative Files and External Libraries

Assume you have a file structure:

  - `main.ts`
  - `utils.ts` (contains `export const magicNumber = 42;`)

<!-- end list -->

```typescript
// main.ts
import { spawn } from "multithreading";

spawn(async () => {
  // 1. Importing a relative file
  // This path is relative to 'main.ts' (the caller location)
  const utils = await import("./utils.ts");
  // 2. Importing an external library (e.g., from a URL or node_modules resolution)
  const _ = await import("lodash");

  console.log("Magic number from relative file:", utils.magicNumber);
  console.log("Random number via lodash:", _.default.random(1, 100));
  
  return utils.magicNumber;
});
```

-----

## API Reference

### Runtime

  * **`spawn(fn)`**: Runs a function in a worker.
  * **`spawn(move(arg1, arg2, ...), fn)`**: Runs a function in a worker with specific arguments transferred or copied.
  * **`initRuntime(config)`**: Initializes the thread pool (optional, lazy loaded by default).
  * **`shutdown()`**: Terminates all workers in the pool.

### Memory Management

  * **`move(...args)`**: Marks arguments for transfer (ownership move) rather than structured clone. Accepts a variable number of arguments which map to the arguments of the worker function.
  * **`drop(resource)`**: Explicitly disposes of a resource (calls `[Symbol.dispose]`). This is required for manual lock management in environments like Bun.
  * **`SharedJsonBuffer`**: A class for storing JSON objects in shared memory.

### Synchronization

  * **`Mutex<T>`**:
      * `acquire()`: Async lock (Recommended). Returns `Promise<MutexGuard>`.
      * `tryLock()`: Non-blocking attempt. Returns boolean.
      * `acquireSync()`: Blocking lock (Halts Worker). Returns `MutexGuard`.
  * **`RwLock<T>`**:
      * `read()`: Async shared read access (Recommended).
      * `write()`: Async exclusive write access (Recommended).
      * `readSync()` / `writeSync()`: Synchronous/Blocking variants.
  * **`Semaphore`**:
      * `acquire(amount?)`: Async wait for `n` permits. Returns `SemaphoreGuard`.
      * `tryAcquire(amount?)`: Non-blocking. Returns `SemaphoreGuard` or `null`.
      * `acquireSync(amount?)`: Blocking wait. Returns `SemaphoreGuard`.
  * **`Condvar`**:
      * `wait(guard)`: Async wait (Recommended). Yields execution.
      * `notifyOne()`: Wake one waiting thread.
      * `notifyAll()`: Wake all waiting threads.
      * `waitSync(guard)`: Blocking wait (Halts Worker).

-----

## Technical Implementation Details

For advanced users interested in the internal mechanics:

  * **Serialization Protocol**: The library uses a custom "Envelope" protocol (`PayloadType.RAW` vs `PayloadType.LIB`). This allows complex objects like `Mutex` handles to be serialized, sent to a worker, and rehydrated into a functional object connected to the same `SharedArrayBuffer` on the other side.
  * **Atomics**: Synchronization is built on `Int32Array` backed by `SharedArrayBuffer` using `Atomics.wait` and `Atomics.notify`.
  * **Import Patching**: The `spawn` function analyzes the stack trace to determine the caller's file path. It then regex-patches `import()` statements within the worker code string to ensure relative paths resolve correctly against the caller's location, rather than the worker's location.
