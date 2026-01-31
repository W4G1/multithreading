type TransferableType = NonNullable<
  StructuredSerializeOptions["transfer"]
>[number];

const CANDIDATES = [
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

// Pre-compute the available constructors once.
// We use a dense array to avoid sparse array lookups.
const CONSTRUCTORS: any[] = [];
const G = globalThis as any;

for (let i = 0; i < CANDIDATES.length; i++) {
  const ctor = G[CANDIDATES[i]!];
  if (typeof ctor !== "undefined") {
    CONSTRUCTORS.push(ctor);
  }
}

// Cache length to avoid property lookup in the hot loop
const LEN = CONSTRUCTORS.length;

// Cache ArrayBuffer specifically if it exists (it's index 0 usually)
// This allows a "Fast Path" for the most common transfer type.
const AB = G.ArrayBuffer;

abstract class TransferableInstance {
  static [Symbol.hasInstance](instance: unknown): boolean {
    // Fast Fail: Null check
    if (!instance) return false;

    // Fast Fail: Primitive check
    // "object" check excludes primitives. Transferables are never functions,
    // and typeof function !== 'object', so this correctly filters functions too.
    if (typeof instance !== "object") return false;

    // Fast Path: ArrayBuffer
    // 90% of transferables are ArrayBuffers. Check this O(1) before entering the loop.
    if (AB && instance instanceof AB) return true;

    for (let i = 0; i < LEN; i++) {
      if (instance instanceof CONSTRUCTORS[i]) return true;
    }

    return false;
  }
}

export type Transferable = TransferableType;
export const Transferable = TransferableInstance as unknown as {
  [Symbol.hasInstance](instance: unknown): instance is TransferableType;
};
