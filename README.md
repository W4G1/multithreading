<div align="center">

  ![Logo](https://github.com/user-attachments/assets/0981b64a-8c55-48b5-b369-0c765757a162)

  <h1>Multithreading.js</h1>

  <p>
    <strong>Robust, Rust-inspired concurrency primitives for the JavaScript ecosystem.</strong>
  </p>

  [![License](https://img.shields.io/github/license/W4G1/multithreading)](https://github.com/W4G1/multithreading/blob/main/LICENSE.md)
  [![Downloads](https://img.shields.io/npm/dw/multithreading?color=%238956FF)](https://www.npmjs.com/package/multithreading)
  [![NPM version](https://img.shields.io/npm/v/multithreading)](https://www.npmjs.com/package/multithreading?activeTab=versions)
  [![GitHub Repo stars](https://img.shields.io/github/stars/W4G1/multithreading?logo=github&label=Star&labelColor=rgb(26%2C%2030%2C%2035)&color=rgb(13%2C%2017%2C%2023))](https://github.com/W4G1/multithreading)
</div>

<br />

**Multithreading** is a TypeScript library that brings robust, Rust-inspired concurrency primitives to the JavaScript ecosystem. It provides a thread-pool architecture, strict memory safety semantics, and synchronization primitives like Mutexes, Read-Write Locks, and Condition Variables.

This library is designed to abstract away the complexity of managing `WebWorkers`, serialization, and `SharedArrayBuffer` complexities, allowing developers to write multi-threaded code that looks and feels like standard asynchronous JavaScript.

## Installation

```bash
npm install multithreading
```

See: [Browser compatibility](#browser-compatibility)

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
  console.log("Result:", result.value); // 0.6378467071314606
} else {
  console.error("Worker error:", result.error);
}
```

-----

## Passing Data: The `move()` Function

Because Web Workers run in a completely isolated context, functions passed to `spawn` cannot capture variables from their outer scope. If you attempt to use a variable inside the worker that was defined outside of it, the code will fail.

To get data from your main thread into the worker, you have to use the `move()` function.

The `move` function accepts a variable number of arguments. These arguments are passed to the worker function in the order they were provided. Despite the name, `move` handles data in two ways:

1.  **Transferable Objects (e.g., `ArrayBuffer`, `Uint32Array`):** These are "moved" (zero-copy). Ownership transfers to the worker, and the original becomes unusable in the main thread.
2.  **Non-Transferable Objects (e.g., JSON, numbers, strings):** These are cloned via structured cloning. They remain usable in the main thread.

<!-- end list -->

```typescript
import { spawn, move } from "multithreading";

// Will be transferred
const largeData = new Uint8Array(1024 * 1024 * 10); // 10MB
// Will be cloned
const metaData = { id: 1 };

const handle = spawn(move(largeData, metaData), (data, meta) => {
  console.log("Processing ID:", meta.id);
  return data.byteLength;
});

await handle.join();
```

-----

## SharedJsonBuffer: Complex Objects in Shared Memory

`SharedJsonBuffer` enables Mutex-protected shared memory for JSON objects, eliminating the overhead of `postMessage` data copying. It supports partial updates by utilizing [Proxies](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) under the hood, reserializing only changed bytes rather than the entire object tree for high-performance state synchronization, especially with large JSON objects.

**Note:** Initializing a `SharedJsonBuffer` has a performance cost. For single-use transfers, `SharedJsonBuffer` is slower than cloning. This data structure is optimized for large persistent shared state or objects that need to be passed around frequently between threads.

```typescript
import { spawn, move, Mutex, SharedJsonBuffer } from "multithreading";

const sharedState = new Mutex(new SharedJsonBuffer({
  score: 0,
  players: ["Main Thread"],
  level: {
    id: 1,
    title: "Start",
  },
}));

await spawn(move(sharedState), async (sharedState) => {
  using guard = await sharedState.lock();

  const state = guard.value;

  console.log(`Current Score: ${state.score}`);

  // Modify the data
  state.score += 100;
  state.players.push("Worker1");

  // End of scope: Lock is automatically released here
}).join();

// Verify on main thread
using guard = await sharedState.lock();

console.log(guard.value); // { score: 100, players: ["Main Thread", "Worker1"], ... }
```

-----

## Synchronization Primitives

When multiple threads access shared memory (via `SharedArrayBuffer`), race conditions occur. This library provides primitives to synchronize access safely.

**Best Practice:** It is highly recommended to use the asynchronous methods (e.g., `acquire`, `read`, `write`, `wait`) rather than their synchronous counterparts. Synchronous blocking halts the entire Worker thread, potentially pausing other tasks sharing that worker.

### 1\. Mutex (Mutual Exclusion)

A `Mutex` ensures that only one thread can access a specific piece of data at a time.

#### Option A: Automatic Management (Recommended)

This library has support for the [Explicit Resource Management](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using) proposal (`using` keyword). When you acquire a lock, it returns a guard. When that guard goes out of scope, the lock is automatically released.

```typescript
import { spawn, move, Mutex } from "multithreading";

const buffer = new SharedArrayBuffer(4);
const counterMutex = new Mutex(new Int32Array(buffer));

spawn(move(counterMutex), async (mutex) => {
  // 'using' automatically disposes the lock at the end of the scope
  using guard = await mutex.lock();
  
  guard.value[0]++;
  
  // End of scope: Lock is released here
});
```

#### Option B: Manual Management (Bun / Standard JS)

If you are using **Bun** or prefer standard JavaScript syntax, you must manually release the lock using `.dispose()`.

**Note on Bun:** While Bun is supported, it's runtime automatically polyfills the `using` keyword whenever a function is stringified. This transpiled code relies on specific internal globals made available in the context where the function is serialized. Because the worker runs in a different isolated context where these globals are not registered, code with `using` will fail to execute.

Always use a `try...finally` block to ensure the lock is released even if an error occurs.

```typescript
import { spawn, move, Mutex } from "multithreading";

const counterMutex = new Mutex(new Int32Array(new SharedArrayBuffer(4)));

spawn(move(counterMutex), async (mutex) => {
  // 1. Acquire the lock manually
  const guard = await mutex.lock();

  try {
    // 2. Critical Section
    guard.value[0]++;
  } finally {
    // 3. Explicitly release the lock
    guard.dispose();
  }
});
```

### 2\. RwLock (Read-Write Lock)

A `RwLock` is optimized for scenarios where data is read often but written rarely. It allows **multiple** simultaneous readers but only **one** writer.

```typescript
import { spawn, move, RwLock } from "multithreading";

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
    using _slot = await sem.acquire(); 
    
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
  // Acquire 2 permits at once
  const guard = await sem.acquire(2);
  
  try {
    // Critical Section
  } finally {
    // Release the 2 permits
    guard.dispose();
  }
});
```

### 4\. Condvar (Condition Variable)

A `Condvar` allows threads to wait for a specific condition to become true. It saves CPU resources by putting the task to sleep until it is notified, rather than constantly checking a value.

```typescript
import { spawn, move, Mutex, Condvar } from "multithreading";

const mutex = new Mutex(new Int32Array(new SharedArrayBuffer(4)));
const cv = new Condvar();

spawn(move(mutex, cv), async (mutex, cv) => {
  using guard = await mutex.lock();
  
  // Wait until value is not 0
  while (guard.value[0] === 0) {
    // wait() unlocks the mutex, waits for notification, then re-locks
    await cv.wait(guard);
  }
  
  console.log("Received signal, value is:", guard.value[0]);
});
```

-----

## Channels (MPMC)

For higher-level communication, this library provides a **Multi-Producer, Multi-Consumer (MPMC)** bounded channel. This primitive mimics Rust's `std::sync::mpsc` but allows for multiple consumers. It acts as a thread-safe queue that handles backpressure, blocking receivers when empty and blocking senders when full.

Channels are the preferred way to coordinate complex workflows (like job queues or pipelines) between workers without manually managing locks.

### Key Features

  * **Arbitrary JSON Data:** Channels are backed by `SharedJsonBuffer`, allowing you to send any JSON-serializable value (objects, arrays, strings, numbers, booleans) through the channel, not just raw integers.
  * **Bounded:** You define a capacity. If the channel is full, `send()` waits. If empty, `recv()` waits.
  * **Clonable:** Both `Sender` and `Receiver` can be cloned and moved to different workers.
  * **Reference Counted:** The channel automatically closes when all Senders are dropped (indicating no more data will arrive) or all Receivers are dropped.

### Example: Worker Pipeline with Objects

```typescript
import { spawn, move, channel } from "multithreading";

// Create a channel that holds objects
const [tx, rx] = channel<{ hello: string }>();

// Producer Thread
spawn(move(tx), async (sender) => {
  await sender.send({ hello: "world" });
  await sender.send({ hello: "multithreading" });
  // Sender is destroyed here, automatically closing the channel
  // because the last `tx` goes out of scope here.
});

// Consumer Thread
spawn(move(rx.clone()), async (receiver) => {
  for await (const value of receiver) {
    console.log(value); // { hello: "world" }
  }
});

// Because we cloned rx, the main thread also still has a handle
for await (const value of rx) {
  console.log(value); // { hello: "world" }
}
```

## Importing Modules in Workers

This library simplifies module loading within Web Workers by supporting standard dynamic `await import()` calls. It automatically handles path resolution, allowing you to import dependencies relative to the file calling `spawn`, rather than the worker's internal location.

You can import:

1.  **External Libraries:** Packages from npm or CDNs (depending on your environment).
2.  **Relative Files:** Local modules relative to the file where `spawn` is executed.

**Note:** The function passed to `spawn` must be self-contained or explicitly import what it needs. It cannot access variables from the outer scope unless they are passed via `move()`.

### Example: Importing Relative Files and External Libraries

Assume you have a file structure:

  - `main.ts`
  - `utils.ts` (contains `export const magicNumber = 42;`)

<!-- end list -->

```typescript
// main.ts
import { spawn } from "multithreading";

spawn(async () => {
  // Importing relative files
  const utils = await import("./utils.ts");
  // Importing external libraries
  const { v4: uuiv4 } = await import("uuid");

  console.log("Magic number from relative file:", utils.magicNumber);
  console.log("Random UUID:", uuiv4());
  
  return utils.magicNumber;
});
```

-----

## Browser Compatibility

**Core features** (like `spawn` and `move`) work in all modern browsers without special configuration.

**Synchronization primitives** (`Mutex`, `RwLock`, `SharedJsonBuffer`, etc.) rely on `SharedArrayBuffer`, which requires your page to be **Cross-Origin Isolated**. To use these specific features, your server must send the following headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

If these headers are missing, basic threading will work, but attempting to use synchronization primitives will result in an error.

### Content Security Policy (CSP)

This library utilizes dynamic imports via `data:` and `blob:`  URLs to generate worker entry points from inline functions.

If your application uses a Content Security Policy (CSP), you must ensure that your `script-src` directive allows the `data:` scheme and your `worker-src` directive allows the `blob:` scheme.

**Required CSP Headers:**

```http
Content-Security-Policy: default-src 'self'; worker-src 'self' blob:; script-src 'self' data: https:;
```

-----

## API Reference

### Runtime

  * **`spawn(fn)`**: Runs a function in a worker.
  * **`spawn(move(arg1, arg2, ...), fn)`**: Runs a function in a worker with specific arguments transferred or cloned.
  * **`initRuntime(config)`**: Initializes the thread pool (optional, lazy loaded by default).
  * **`shutdown()`**: Terminates all workers in the pool.

### Memory Management

  * **`move(...args)`**: Marks arguments for transfer (ownership move) or clone, depending on the data type. Accepts a variable number of arguments which map to the arguments of the worker function.
  * **`drop(resource)`**: Explicitly disposes of a resource (calls `[Symbol.dispose]`).
  * **`SharedJsonBuffer`**: A class for storing JSON objects in shared memory.

### Channels (MPMC)

  * **`channel<T>(capacity)`**: Creates a new channel. Returns `[Sender<T>, Receiver<T>]`.
  * **`Sender<T>`**:
      * `send(value)`: Async. Returns `Promise<Result<void, Error>>`.
      * `blockingSend(value)`: Blocking. Returns `Result<void, Error>`.
      * `clone()`: Creates a new handle to the same channel (increments ref count).
      * `close()`: Manually closes the channel for everyone.
  * **`Receiver<T>`**:
      * `recv()`: Async. Returns `Promise<Result<T, Error>>`.
      * `blockingRecv()`: Blocking. Returns `Result<T, Error>`.
      * `clone()`: Creates a new handle to the same channel.
      * `close()`: Manually drops this handle.

### Synchronization

  * **`Mutex<T>`**:
      * `lock()`: Async lock (Recommended). Returns `Promise<MutexGuard>`.
      * `tryLock()`: Non-blocking attempt. Returns boolean.
      * `blockingLock()`: Blocking lock (Halts Worker). Returns `MutexGuard`.
  * **`RwLock<T>`**:
      * `read()`: Async shared read access (Recommended).
      * `write()`: Async exclusive write access (Recommended).
      * `blockingRead()` / `blockingWrite()`: Synchronous/Blocking variants.
  * **`Semaphore`**:
      * `acquire(amount?)`: Async wait for `n` permits (Recommended). Returns `Promise<SemaphoreGuard>`.
      * `tryAcquire(amount?)`: Non-blocking. Returns `SemaphoreGuard` or `null`.
      * `blockingAcquire(amount?)`: Blocking wait. Returns `SemaphoreGuard`.
  * **`Condvar`**:
      * `wait(guard)`: Async wait (Recommended). Yields execution.
      * `notifyOne()`: Wake one waiting thread.
      * `notifyAll()`: Wake all waiting threads.
      * `blockingWait(guard)`: Blocking wait (Halts Worker).

-----

## Technical Implementation Details

For advanced users interested in the internal mechanics:

  * **Serialization Protocol**: The library uses a custom "Envelope" protocol (`PayloadType.RAW` vs `PayloadType.LIB`). This allows complex objects like `Mutex` handles to be serialized, sent to a worker, and rehydrated into a functional object connected to the same `SharedArrayBuffer` on the other side.
  * **Atomics**: Synchronization is built on `Int32Array` backed by `SharedArrayBuffer` using `Atomics.wait` and `Atomics.notify`.
  * **Import Patching**: The `spawn` function analyzes the stack trace to determine the caller's file path. It then regex-patches `import()` statements within the worker code string to ensure relative paths resolve correctly against the caller's location, rather than the worker's location.
