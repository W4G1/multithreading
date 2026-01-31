type TransferableType = NonNullable<
  StructuredSerializeOptions["transfer"]
>[number];

const TRANSFERABLES = [
  "ArrayBuffer",
  "MessagePort",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "OffscreenCanvas",
  "ImageBitmap",
  "VideoFrame",
  "AudioData",
  "RTCDataChannel",
] as const;

const AVAILABLE_TRANSFERABLES = TRANSFERABLES
  .map((name) => (globalThis as any)[name])
  .filter((ctor) => typeof ctor !== "undefined");

abstract class TransferableInstance {
  static [Symbol.hasInstance](instance: unknown): boolean {
    if (!instance || typeof instance !== "object") return false;

    // SharedArrayBuffer throws if transferred
    if (instance instanceof SharedArrayBuffer) {
      return false;
    }

    return AVAILABLE_TRANSFERABLES.some((t) => instance instanceof t);
  }
}

export type Transferable = TransferableType;
export const Transferable = TransferableInstance as unknown as {
  [Symbol.hasInstance](instance: unknown): instance is TransferableType;
};
