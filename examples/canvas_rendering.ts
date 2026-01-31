import { move, spawn } from "multithreading";

// Get the canvas from the DOM
const canvasEl = document.getElementById("game-map") as HTMLCanvasElement;

// This creates an 'OffscreenCanvas' which is detachable and Transferable
const offscreen = canvasEl.transferControlToOffscreen();

// We move 'offscreen' into the worker. The main thread loses access to it
spawn(move(offscreen), (canvas) => {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;

  // Perform heavy math (e.g., Perlin Noise)
  // Iterating 1,000,000+ pixels is CPU intensive.
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  // Simple "noise" generation loop
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      // Heavy calculation per pixel
      const value = Math.floor(Math.random() * 255);

      const index = (y * width + x) * 4;
      data[index] = value; // Red (Height)
      data[index + 1] = 100; // Green (Grass)
      data[index + 2] = 50; // Blue (Water)
      data[index + 3] = 255; // Alpha
    }
  }

  ctx.putImageData(imageData, 0, 0);
});

console.log("Main thread continues running at 60fps...");
