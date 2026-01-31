import { move, spawn } from "multithreading";
import fs from "fs/promises";

const files = ["photo1.jpg", "photo2.jpg", "photo3.jpg"];

// Process images in parallel
const tasks = files.map((file) =>
  spawn(move(file), async (filename) => {
    const { Jimp } = await import("jimp");

    const image = await Jimp.read(filename);

    image.resize({ w: 1024, h: 768 });

    const newImage = await image.getBuffer("image/jpeg", {
      quality: 80,
    });

    // Instantly return the raw binary buffer (Uint8Array, zero-copy)
    return newImage;
  })
);

// Wait for all tasks to finish
const results = await Promise.all(tasks.map((t) => t.join()));

// Save the raw buffers directly to disk
for (const [i, result] of results.entries()) {
  if (!result.ok) continue;

  await fs.writeFile(`output_${i}.jpg`, result.value);
  console.log(`Saved output_${i}.jpg (${result.value.byteLength} bytes)`);
}
