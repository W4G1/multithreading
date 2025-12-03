// @ts-nocheck This is a polyfill file

const isBrowser = "navigator" in globalThis &&
  !("process" in globalThis) &&
  !("Deno" in globalThis) &&
  !("Bun" in globalThis);

if (isBrowser) {
  // If running in a browser (or anywhere) and SharedArrayBuffer is undefined
  // (usually due to missing COOP/COEP security headers), shim it
  if (typeof globalThis.SharedArrayBuffer === "undefined") {
    globalThis.SharedArrayBuffer = class SharedArrayBuffer {};
  }
}
