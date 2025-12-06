// @ts-nocheck This is a polyfill file

const isBrowser = "navigator" in globalThis &&
  !("process" in globalThis) &&
  !("Deno" in globalThis) &&
  !("Bun" in globalThis);

if (isBrowser) {
  if (typeof globalThis.SharedArrayBuffer === "undefined") {
    globalThis.SharedArrayBuffer = class SharedArrayBuffer {
      constructor() {
        throw new Error(
          "SharedArrayBuffer is unavailable because of insufficient security headers. Please ensure that your page is Cross-Origin Isolated (COOP) and that your server sends the following headers: Cross-Origin-Opener-Policy: same-origin; Cross-Origin-Embedder-Policy: require-corp",
        );
      }
    };
  }
}
