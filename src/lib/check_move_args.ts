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

const WARNING_MSG =
  "Warning: You are passing a SharedArrayBuffer to a worker without locking. Please wrap this data in a Mutex() or RwLock() to prevent race conditions.";

function warnUnsafe() {
  console.warn(WARNING_MSG);
}

export function checkMoveArgs(args: any[]) {
  const len = args.length;

  for (let i = 0; i < len; i++) {
    const arg = args[i];

    // If it's null or not an object, it cannot be a SAB or Class Instance.
    if (!arg || typeof arg !== "object") continue;

    if (arg instanceof SharedArrayBuffer) {
      warnUnsafe();
      continue;
    }

    // We strictly use isView first (native slot check) to avoid accessing .buffer on random objects
    if (ArrayBuffer.isView(arg) && arg.buffer instanceof SharedArrayBuffer) {
      warnUnsafe();
      continue;
    }

    if (arg[toSerialized] !== undefined) {
      if (
        arg instanceof Mutex ||
        arg instanceof Condvar ||
        arg instanceof RwLock ||
        arg instanceof Sender ||
        arg instanceof Receiver ||
        arg instanceof Semaphore ||
        arg instanceof Barrier
      ) {
        continue;
      }

      // If it had the symbol but wasn't a lock, it's unsafe.
      warnUnsafe();
    }
  }
}
