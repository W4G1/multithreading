import { move, spawn } from "multithreading";

async function hashPassword(password: string): Promise<string> {
  const handle = spawn(move(password), async (password) => {
    const bcrypt = await import("bcryptjs");

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    return hash;
  });

  const result = await handle.join();

  if (!result.ok) {
    throw result.error;
  }

  return result.value;
}

// We can now process all 3 requests at once. Because they run in background threads,
// the main thread stays free, and the passwords are hashed in parallel
// (simultaneously) rather than one by one.
await Promise.all([
  hashPassword("123456"),
  hashPassword("admin"),
  hashPassword("password"),
]);
