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
