import {
  Barrier,
  Condvar,
  Mutex,
  Receiver,
  RwLock,
  Semaphore,
  Sender,
} from "./lib.ts";
import { toSerialized } from "./shared.ts";

export function checkMoveArgs(args: any[]) {
  for (const arg of args) {
    const isRawSAB = arg instanceof SharedArrayBuffer;
    // Check if it's a TypedArray (e.g. Uint8Array) viewing a Shared buffer
    const isViewSAB = ArrayBuffer.isView(arg) &&
      arg.buffer instanceof SharedArrayBuffer;
    const isThreadSafe = arg instanceof Mutex || arg instanceof Condvar ||
      arg instanceof RwLock || arg instanceof Sender ||
      arg instanceof Receiver || arg instanceof Semaphore ||
      arg instanceof Barrier;
    const isLibrarySAB = !isThreadSafe &&
      typeof arg[toSerialized] !== "undefined";

    if (isRawSAB || isViewSAB || isLibrarySAB) {
      console.warn(
        "Warning: You are passing a SharedArrayBuffer to a worker without locking. Please wrap this data in a Mutex() or RwLock() to prevent race conditions.",
      );
    }
  }
}
