/**
 * Applies a monkey patch for Atomics.waitAsync specifically for the Deno environment.
 * In Deno, the V8 message loop is drained at the start of event loop iterations,
 * meaning standard V8 wakeups might not trigger immediate processing of waitAsync.
 * This monkey patch injects a setInterval "tick" to ensure the event loop stays active
 * and wakes up to process the atomic notification.
 *
 * waitAsync, along with GC, WeakRef/FinalizationRegistry callbacks and WebAssembly async compilation, are things
 * that happen when the V8 message loop is drained. V8 usually expects the message loop to be more or less continuously
 * drained, so that the message loop is the event loop, but Deno instead drains the message loop at the beginning of every
 * event loop iteration. As such, V8 doesn't have any way to wake up Deno's event loop, and the waitAsync timeout will
 * only fire when the event loop is woken up in some other way:
 */
import { setImmediate } from "node:timers";

if ("Deno" in globalThis) {
  const originalWaitAsync = Atomics.waitAsync;

  // @ts-ignore: Overwriting native function signature
  Atomics.waitAsync = function (
    typedArray: Int32Array | BigInt64Array,
    index: number,
    value: number | bigint,
    timeout?: number,
  ) {
    // Call original
    const result = originalWaitAsync(
      // @ts-ignore: We simplified the function signature
      typedArray,
      index,
      value,
      timeout,
    );

    // If sync, return immediately
    if (result.async === false) {
      return result;
    }

    // Wrap the promise to keep the loop churning
    const originalPromise = result.value;

    const wrappedPromise = (async () => {
      let active = true;

      // Recursive setImmediate keeps the loop active without
      // the overhead of the timer heap (calculating milliseconds).
      const keepAlive = () => {
        if (!active) return;
        setImmediate(keepAlive);
      };

      // Kick off the loop
      keepAlive();

      try {
        return await originalPromise;
      } finally {
        // Stop the loop
        active = false;
      }
    })();

    return {
      async: true,
      value: wrappedPromise,
    };
  };
}
