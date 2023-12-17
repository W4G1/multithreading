export default globalThis.Worker || (await import("web-worker")).default;
