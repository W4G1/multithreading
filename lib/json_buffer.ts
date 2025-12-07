import {
  register,
  type Serializable,
  toDeserialized,
  toSerialized,
} from "./shared.ts";

export type Proxyable = Record<string | symbol, any> | any[];

const CONSOLE_VIEW = Symbol.for("SharedJsonBuffer.consoleView");

const OFFSET_FREE_PTR = 0;
const OFFSET_ROOT = 8; // 8-byte aligned
const HEADER_SIZE = 16;

const TYPE_NULL = 0;
const TYPE_TRUE = 1;
const TYPE_FALSE = 2;
const TYPE_NUMBER = 3;
const TYPE_STRING = 4;
const TYPE_OBJECT = 5;
const TYPE_ARRAY = 6;
const TYPE_MOVED = 0xffffffff;

interface Pointer {
  __ptr: number;
}

interface StackRoot {
  handle: Pointer;
  type: number;
}

function initConsoleHooks() {
  if (typeof console === "undefined") return;

  const methods = [
    "log",
    "info",
    "warn",
    "error",
    "dir",
    "table",
    "debug",
    "trace",
  ] as const;

  for (const method of methods) {
    const original = console[method];

    console[method] = function (this: any, ...args: any[]) {
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        // Check if it's our object and has the specific console view method
        if (
          arg && typeof arg === "object" &&
          typeof arg[CONSOLE_VIEW] === "function"
        ) {
          try {
            // We access the hidden method via the Proxy trap
            args[i] = arg[CONSOLE_VIEW]();
          } catch (e) {
            // Fallback if something goes wrong
            args[i] = arg;
          }
        }
      }

      return original.apply(this, args);
    };
  }
}

class SharedJsonBufferImpl<T extends Proxyable> implements Serializable {
  static {
    initConsoleHooks();
    register(this);
  }

  // Views
  public _u32!: Uint32Array;
  public _f64!: Float64Array;
  public _u8!: Uint8Array;

  private buffer!: SharedArrayBuffer;
  private _textDecoder = new TextDecoder();
  private _textEncoder = new TextEncoder();

  // Caches
  private _stringCache = new Map<number, string>();
  private proxyCache = new Map<number, WeakRef<any>>();
  private propertyHints = new Map<string, number>();

  // GC State
  private activeTargets = new Set<Pointer>();
  private tempRoots: StackRoot[] = [];

  // Instance Scratch Variables
  public s_ptr = 0; // Public for ArrayCursor access
  public s_cap = 0;
  public s_len = 0;
  public s_start = 0;

  constructor(initial: T, options?: { size?: number });
  constructor(initial: T, buffer: SharedArrayBuffer);
  constructor(
    obj: T,
    optionsOrBuffer?: SharedArrayBuffer | { size?: number },
  ) {
    if (optionsOrBuffer instanceof SharedArrayBuffer) {
      this.buffer = optionsOrBuffer;
      this.initViews();

      if (Atomics.load(this._u32, OFFSET_FREE_PTR >> 2) === 0) {
        this.initializeBuffer(obj);
      }
    } else {
      const size = optionsOrBuffer?.size || 1024 * 64;
      this.buffer = new SharedArrayBuffer(size);
      this.initViews();
      this.initializeBuffer(obj);
    }

    return this.getRootProxy();
  }

  private initViews() {
    this._u32 = new Uint32Array(this.buffer);
    this._f64 = new Float64Array(this.buffer);
    this._u8 = new Uint8Array(this.buffer);
  }

  private initializeBuffer(obj: T) {
    Atomics.store(this._u32, OFFSET_FREE_PTR >> 2, HEADER_SIZE);

    const isArr = Array.isArray(obj);
    const initialKeys = isArr
      ? obj.length
      : (obj ? Object.keys(obj).length : 0);

    const rootPtr = isArr
      ? this.allocArray(initialKeys)
      : this.allocObject(initialKeys);

    Atomics.store(this._u32, OFFSET_ROOT >> 2, rootPtr);

    if (obj) {
      const rootTarget = { __ptr: rootPtr };
      this.tempRoots.push({
        handle: rootTarget,
        type: isArr ? TYPE_ARRAY : TYPE_OBJECT,
      });
      try {
        this.writeInitial(rootTarget, obj);
      } finally {
        this.tempRoots.pop();
        Atomics.store(this._u32, OFFSET_ROOT >> 2, rootTarget.__ptr);
      }
    }
  }

  private getRootProxy(): any {
    const rootPtr = Atomics.load(this._u32, OFFSET_ROOT >> 2);
    return this.getProxyForPtr(rootPtr);
  }

  private alloc(byteSize: number, retry = true): number {
    const idx = OFFSET_FREE_PTR >> 2;
    const currentPtr = Atomics.load(this._u32, idx);

    // Align to 8 bytes for Float64 performance
    const nextPtr = currentPtr + byteSize;
    const alignedNext = (nextPtr + 7) & ~7;

    if (alignedNext > this.buffer.byteLength) {
      if (retry) {
        this.collectGarbage();
        this.propertyHints.clear();
        return this.alloc(byteSize, false);
      }
      throw new Error(
        `SharedJsonBuffer OOM: Used ${alignedNext} of ${this.buffer.byteLength}`,
      );
    }

    Atomics.store(this._u32, idx, alignedNext);
    return currentPtr;
  }

  private collectGarbage() {
    const tempBuffer = new ArrayBuffer(this.buffer.byteLength);
    const tempU32 = new Uint32Array(tempBuffer);
    const tempF64 = new Float64Array(tempBuffer);
    const tempU8 = new Uint8Array(tempBuffer);

    let freePtr = HEADER_SIZE;
    const visited = new Map<number, number>();

    const allocTemp = (size: number) => {
      const ptr = freePtr;
      freePtr = (freePtr + size + 7) & ~7;
      if (freePtr > tempBuffer.byteLength) {
        throw new Error("GC Fatal: Fragmentation too high");
      }
      return ptr;
    };

    const relocate = (oldPtr: number, type: number): number => {
      if (oldPtr === 0) return 0;

      if (type === TYPE_STRING) {
        if (visited.has(oldPtr)) return visited.get(oldPtr)!;
        const len = this._u32[oldPtr >> 2]!;
        const newPtr = allocTemp(4 + len);
        tempU32[newPtr >> 2] = len;
        tempU8.set(
          this._u8.subarray(oldPtr + 4, oldPtr + 4 + len),
          newPtr + 4,
        );
        visited.set(oldPtr, newPtr);
        return newPtr;
      }

      if (type === TYPE_NUMBER) {
        if (visited.has(oldPtr)) return visited.get(oldPtr)!;
        const newPtr = allocTemp(8);
        tempF64[newPtr >> 3] = this._f64[oldPtr >> 3]!;
        visited.set(oldPtr, newPtr);
        return newPtr;
      }

      this.resolvePtr(oldPtr);
      const actualOldPtr = this.s_ptr;

      if (visited.has(actualOldPtr)) return visited.get(actualOldPtr)!;

      const actualType = this._u32[actualOldPtr >> 2]!;
      let newPtr = 0;

      if (actualType === TYPE_OBJECT) {
        const count = this._u32[(actualOldPtr + 8) >> 2]!;
        const newCap = Math.max(4, count);
        newPtr = allocTemp(12 + newCap * 12);

        tempU32[newPtr >> 2] = TYPE_OBJECT;
        tempU32[(newPtr + 4) >> 2] = newCap;
        tempU32[(newPtr + 8) >> 2] = count;

        const startOffset = actualOldPtr + 12;
        const newStartOffset = newPtr + 12;

        for (let i = 0; i < count; i++) {
          const entryOff = startOffset + i * 12;
          const kPtr = this._u32[entryOff >> 2]!;
          const vType = this._u32[(entryOff + 4) >> 2]!;
          const vPayload = this._u32[(entryOff + 8) >> 2]!;

          const newKeyPtr = relocate(kPtr, TYPE_STRING);

          let newPayload = vPayload;
          if (
            vType === TYPE_OBJECT || vType === TYPE_ARRAY ||
            vType === TYPE_STRING || vType === TYPE_NUMBER
          ) {
            newPayload = relocate(vPayload, vType);
          }

          const destOff = newStartOffset + i * 12;
          tempU32[destOff >> 2] = newKeyPtr;
          tempU32[(destOff + 4) >> 2] = vType;
          tempU32[(destOff + 8) >> 2] = newPayload;
        }
      } else if (actualType === TYPE_ARRAY) {
        const len = this._u32[(actualOldPtr + 8) >> 2]!;
        const newCap = Math.max(4, len);
        newPtr = allocTemp(12 + newCap * 8);

        tempU32[newPtr >> 2] = TYPE_ARRAY;
        tempU32[(newPtr + 4) >> 2] = newCap;
        tempU32[(newPtr + 8) >> 2] = len;

        const startOffset = actualOldPtr + 12;
        const newStartOffset = newPtr + 12;

        for (let i = 0; i < len; i++) {
          const entryOff = startOffset + i * 8;
          const vType = this._u32[entryOff >> 2]!;
          const vPayload = this._u32[(entryOff + 4) >> 2]!;

          let newPayload = vPayload;
          if (
            vType === TYPE_OBJECT || vType === TYPE_ARRAY ||
            vType === TYPE_STRING || vType === TYPE_NUMBER
          ) {
            newPayload = relocate(vPayload, vType);
          }

          const destOff = newStartOffset + i * 8;
          tempU32[destOff >> 2] = vType;
          tempU32[(destOff + 4) >> 2] = newPayload;
        }
      }

      visited.set(actualOldPtr, newPtr);
      return newPtr;
    };

    const oldRoot = Atomics.load(this._u32, OFFSET_ROOT >> 2);
    const newRoot = relocate(oldRoot, TYPE_OBJECT);

    for (const root of this.tempRoots) {
      relocate(root.handle.__ptr, root.type);
    }

    this._u8.set(new Uint8Array(tempBuffer).subarray(0, freePtr), 0);

    Atomics.store(this._u32, OFFSET_FREE_PTR >> 2, freePtr);
    Atomics.store(this._u32, OFFSET_ROOT >> 2, newRoot);

    this._stringCache.clear();
    this.proxyCache.clear();
    this.propertyHints.clear();

    const fixupPointer = (target: Pointer) => {
      this.resolvePtr(target.__ptr);
      const oldP = this.s_ptr;
      if (visited.has(oldP)) {
        target.__ptr = visited.get(oldP)!;
      } else {
        target.__ptr = 0;
      }
    };

    for (const target of this.activeTargets) {
      fixupPointer(target);
    }
    for (const root of this.tempRoots) {
      fixupPointer(root.handle);
    }
  }

  public resolvePtr(ptr: number) {
    if (ptr === 0) {
      this.s_ptr = 0;
      this.s_len = 0;
      return;
    }

    let curr = ptr;
    let type = this._u32[curr >> 2]!;

    while (type === TYPE_MOVED) {
      curr = this._u32[(curr + 4) >> 2]!;
      type = this._u32[curr >> 2]!;
    }

    this.s_ptr = curr;
    this.s_cap = this._u32[(curr + 4) >> 2]!;
    this.s_len = this._u32[(curr + 8) >> 2]!;
    this.s_start = curr + 12;
  }

  private readString(ptr: number): string {
    if (this._stringCache.has(ptr)) {
      return this._stringCache.get(ptr)!;
    }

    const len = this._u32[ptr >> 2]!;
    const offset = ptr + 4;

    // Optimization: Short strings usually fit in stack/args limit
    // and pure JS loop is often faster than TextDecoder overhead for < 20 chars
    if (len < 64) {
      let res = "";
      for (let i = 0; i < len; i++) {
        res += String.fromCharCode(this._u8[offset + i]!);
      }
      this._stringCache.set(ptr, res);
      return res;
    }

    // Fallback for long strings or special chars
    const str = this._textDecoder.decode(
      this._u8.subarray(offset, offset + len),
    );
    this._stringCache.set(ptr, str);
    return str;
  }

  public readSlot(offset: number): any {
    const type = this._u32[offset >> 2]!;
    const payload = this._u32[(offset + 4) >> 2]!;

    if (type === TYPE_NUMBER) {
      return this._f64[payload >> 3]!;
    }

    switch (type) {
      case TYPE_STRING:
        return this.readString(payload);
      case TYPE_OBJECT:
      case TYPE_ARRAY:
        return this.getProxyForPtr(payload);
      case TYPE_TRUE:
        return true;
      case TYPE_FALSE:
        return false;
      case TYPE_NULL:
        return null;
      default:
        return undefined;
    }
  }

  private writeValue(value: any): { type: number; payload: number } {
    if (typeof value === "number") {
      const ptr = this.alloc(8);
      this._f64[ptr >> 3] = value;
      return { type: TYPE_NUMBER, payload: ptr };
    }
    if (value === null || value === undefined) {
      return { type: TYPE_NULL, payload: 0 };
    }
    if (value === true) return { type: TYPE_TRUE, payload: 0 };
    if (value === false) return { type: TYPE_FALSE, payload: 0 };

    if (typeof value === "string") {
      const encoded = this._textEncoder.encode(value);
      const len = encoded.byteLength;
      const ptr = this.alloc(4 + len);

      this._u32[ptr >> 2] = len;
      this._u8.set(encoded, ptr + 4);
      return { type: TYPE_STRING, payload: ptr };
    }

    if (Array.isArray(value)) {
      const ptr = this.allocArray(value.length);
      const target = { __ptr: ptr };
      this.tempRoots.push({ handle: target, type: TYPE_ARRAY });
      try {
        value.forEach((v, i) => this.arraySet(target, i, v));
      } finally {
        this.tempRoots.pop();
      }
      return { type: TYPE_ARRAY, payload: target.__ptr };
    }

    if (typeof value === "object") {
      const keys = Object.keys(value);
      const ptr = this.allocObject(keys.length);
      const target = { __ptr: ptr };
      this.tempRoots.push({ handle: target, type: TYPE_OBJECT });
      try {
        Object.entries(value).forEach(([k, v]) => this.objectSet(target, k, v));
      } finally {
        this.tempRoots.pop();
      }
      return { type: TYPE_OBJECT, payload: target.__ptr };
    }

    throw new Error(`Unsupported type: ${typeof value}`);
  }

  private allocObject(initialCap: number): number {
    const capacity = Math.max(4, initialCap);
    const byteSize = 12 + capacity * 12;
    const ptr = this.alloc(byteSize);
    const idx = ptr >> 2;
    this._u32[idx] = TYPE_OBJECT;
    this._u32[idx + 1] = capacity;
    this._u32[idx + 2] = 0;
    return ptr;
  }

  private allocArray(initialCap: number): number {
    const capacity = Math.max(4, initialCap);
    const byteSize = 12 + capacity * 8;
    const ptr = this.alloc(byteSize);
    const idx = ptr >> 2;
    this._u32[idx] = TYPE_ARRAY;
    this._u32[idx + 1] = capacity;
    this._u32[idx + 2] = 0;
    return ptr;
  }

  private writeInitial(target: Pointer, data: any) {
    if (Array.isArray(data)) {
      data.forEach((v, i) => this.arraySet(target, i, v));
    } else {
      Object.entries(data).forEach(([k, v]) => this.objectSet(target, k, v));
    }
  }

  public objectHandler: ProxyHandler<any> = {
    get: (target, prop, receiver) => {
      if (typeof prop === "symbol") {
        if (prop === CONSOLE_VIEW) {
          return () => this.toConsoleView(target.__ptr);
        }
        if (prop === toSerialized) return () => this[toSerialized]();
        if (prop === Symbol.iterator) return undefined;
        return Reflect.get(target, prop, receiver);
      }
      if (prop === "__ptr") return target.__ptr;
      if (prop === "toJSON") return () => this.toJSON(target.__ptr);

      const ptr = target.__ptr;
      if (ptr === 0) return undefined;

      // Standard resolution
      let curr = ptr;
      let type = this._u32[curr >> 2]!;
      if (type !== TYPE_MOVED) {
        this.s_len = this._u32[(curr + 8) >> 2]!;
        this.s_start = curr + 12;
      } else {
        this.resolvePtr(ptr);
      }

      const count = this.s_len;
      const start = this.s_start;

      // Check hint
      const hint = this.propertyHints.get(String(prop));
      if (hint !== undefined && hint < count) {
        const entryOffset = start + hint * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;
        const keyStr = this.readString(keyPtr);
        if (keyStr === prop) return this.readSlot(entryOffset + 4);
      }

      // Scan
      for (let i = 0; i < count; i++) {
        const entryOffset = start + i * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;
        const key = this.readString(keyPtr);

        if (key === prop) {
          this.propertyHints.set(String(prop), i);
          return this.readSlot(entryOffset + 4);
        }
      }
      return undefined;
    },

    has: (target, prop) => {
      if (typeof prop === "symbol") {
        if (prop === CONSOLE_VIEW || prop === toSerialized) return true;
        return Reflect.has(target, prop);
      }
      if (prop === "__ptr" || prop === "toJSON") return true;

      this.resolvePtr(target.__ptr);
      if (target.__ptr === 0) return false;

      const propStr = String(prop);
      const count = this.s_len;
      const start = this.s_start;

      // Check hint
      const hint = this.propertyHints.get(propStr);
      if (hint !== undefined && hint < count) {
        const entryOffset = start + hint * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;
        const keyStr = this.readString(keyPtr);
        if (keyStr === propStr) return true;
      }

      // Scan
      for (let i = 0; i < count; i++) {
        const entryOffset = start + i * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;
        const key = this.readString(keyPtr);

        if (key === propStr) {
          this.propertyHints.set(propStr, i);
          return true;
        }
      }
      return false;
    },

    set: (target, prop, value) => {
      if (typeof prop === "symbol") return false;
      this.objectSet(target, String(prop), value);
      return true;
    },

    defineProperty: (target, prop, descriptor) => {
      if (typeof prop === "symbol") return false;

      if (descriptor.get || descriptor.set) {
        throw new Error("SharedJsonBuffer cannot store accessors (get/set)");
      }

      if ("value" in descriptor) {
        this.objectSet(target, String(prop), descriptor.value);
      }

      // We ignore enumerable/configurable/writable.
      return true;
    },

    deleteProperty: (target, prop) => {
      if (typeof prop === "symbol") return false;
      return this.objectDelete(target, String(prop));
    },

    ownKeys: (target) => {
      this.resolvePtr(target.__ptr);
      if (target.__ptr === 0) return [];

      const keys: string[] = [];
      const start = this.s_start;

      // Pre-fill hints during iteration
      for (let i = 0; i < this.s_len; i++) {
        const keyPtr = this._u32[(start + i * 12) >> 2]!;
        const key = this.readString(keyPtr);

        // When GOPD is called immediately after, it will hit this hint.
        this.propertyHints.set(key, i);

        keys.push(key);
      }
      return keys;
    },

    getOwnPropertyDescriptor: (target, prop) => {
      // 1. Reset state to THIS object
      this.resolvePtr(target.__ptr);
      if (target.__ptr === 0) return undefined;

      const count = this.s_len;
      const start = this.s_start;
      const propStr = String(prop);

      // 2. Check hint
      const hint = this.propertyHints.get(propStr);
      if (hint !== undefined && hint < count) {
        const entryOffset = start + hint * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;
        const keyStr = this.readString(keyPtr);

        if (keyStr === propStr) {
          // We just called resolvePtr, so we can read the value now
          const val = this.readSlot(entryOffset + 4);
          return {
            enumerable: true,
            configurable: true,
            writable: true,
            value: val,
          };
        }
      }

      // 3. Scan
      for (let i = 0; i < count; i++) {
        const entryOffset = start + i * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;
        const key = this.readString(keyPtr);

        if (key === propStr) {
          this.propertyHints.set(propStr, i);
          // We just called resolvePtr, so we can read the value now
          const val = this.readSlot(entryOffset + 4);
          return {
            enumerable: true,
            configurable: true,
            writable: true,
            value: val,
          };
        }
      }

      return undefined;
    },
  };

  private getProxyForPtr(ptr: number): any {
    this.resolvePtr(ptr);
    const resolvedPtr = this.s_ptr;

    // Check cache
    if (this.proxyCache.has(resolvedPtr)) {
      const ref = this.proxyCache.get(resolvedPtr);
      const cached = ref?.deref();
      if (cached) return cached; // Return if still in memory
    }

    const type = this._u32[resolvedPtr >> 2]!;

    // Initialize proper target for formatting
    const target = type === TYPE_ARRAY ? [] : {};

    Object.defineProperty(target, "__ptr", {
      value: resolvedPtr,
      writable: true,
      configurable: true,
      enumerable: false, // Ensure this is hidden
    });

    this.activeTargets.add(target as Pointer);

    const proxy = new Proxy(
      target,
      type === TYPE_ARRAY ? this.arrayHandler : this.objectHandler,
    );

    // Store as WeakRef
    this.proxyCache.set(resolvedPtr, new WeakRef(proxy));

    return proxy;
  }

  public toConsoleView(ptr: number, depth = 0): any {
    this.resolvePtr(ptr);
    const len = this.s_len;
    const start = this.s_start;
    const type = this._u32[this.s_ptr >> 2]!;

    const result: any = type === TYPE_ARRAY ? new Array(len) : {};

    // Config: How much to show eagerly?
    const EAGER_DEPTH = 5; // Show root +4 nested levels
    const EAGER_BREADTH = 100; // Only show first 100 items of arrays (default in Node and Deno)

    for (let i = 0; i < len; i++) {
      let key: string | number;
      let offset: number;

      if (type === TYPE_ARRAY) {
        key = i;
        offset = start + i * 8;
      } else {
        const entryOffset = start + i * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;
        key = this.readString(keyPtr);
        offset = entryOffset + 4;
      }

      const itemType = this._u32[offset >> 2]!;
      const itemPayload = this._u32[(offset + 4) >> 2]!;

      if (itemType === TYPE_OBJECT || itemType === TYPE_ARRAY) {
        // Eager vs lazy decision
        // We eagerly decode if:
        // 1. We haven't hit the depth limit and
        // 2. We haven't hit the breadth limit
        const isEager = depth < EAGER_DEPTH && i < EAGER_BREADTH;

        if (isEager) {
          result[key] = this.toConsoleView(itemPayload, depth + 1);
        } else {
          // Lazy Getter: When clicked, restart with depth 0 so the user sees the content
          Object.defineProperty(result, key, {
            enumerable: true,
            configurable: true,
            get: () => {
              return this.toConsoleView(itemPayload, 0);
            },
          });
        }
      } else {
        result[key] = this.readSlot(offset);
      }
    }

    return result;
  }

  public toJSON(ptr: number): any {
    this.resolvePtr(ptr);
    const len = this.s_len;
    const start = this.s_start;
    const type = this._u32[this.s_ptr >> 2]!;

    if (type === TYPE_ARRAY) {
      const arr = new Array(len);
      for (let i = 0; i < len; i++) {
        const offset = start + i * 8;
        const itemType = this._u32[offset >> 2]!;
        const itemPayload = this._u32[(offset + 4) >> 2]!;

        if (itemType === TYPE_OBJECT || itemType === TYPE_ARRAY) {
          arr[i] = this.toJSON(itemPayload);
        } else {
          arr[i] = this.readSlot(offset);
        }
      }
      return arr;
    } else {
      const obj: any = {};
      for (let i = 0; i < len; i++) {
        const entryOffset = start + i * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;
        const key = this.readString(keyPtr);

        const itemType = this._u32[(entryOffset + 4) >> 2]!;
        const itemPayload = this._u32[(entryOffset + 8) >> 2]!;

        if (itemType === TYPE_OBJECT || itemType === TYPE_ARRAY) {
          obj[key] = this.toJSON(itemPayload);
        } else {
          obj[key] = this.readSlot(entryOffset + 4);
        }
      }
      return obj;
    }
  }

  private objectDelete(target: Pointer, key: string): boolean {
    this.resolvePtr(target.__ptr);
    const ptr = this.s_ptr;
    const count = this.s_len;
    const entriesStart = this.s_start;

    let foundIdx = -1;

    for (let i = 0; i < count; i++) {
      const entryOffset = entriesStart + i * 12;
      const keyPtr = this._u32[entryOffset >> 2]!;
      if (this.readString(keyPtr) === key) {
        foundIdx = i;
        break;
      }
    }

    if (foundIdx === -1) return true;

    const lastIdx = count - 1;

    if (foundIdx !== lastIdx) {
      const lastOffset = entriesStart + lastIdx * 12;
      const foundOffset = entriesStart + foundIdx * 12;

      this._u32[foundOffset >> 2] = this._u32[lastOffset >> 2]!;
      this._u32[(foundOffset + 4) >> 2] = this._u32[(lastOffset + 4) >> 2]!;
      this._u32[(foundOffset + 8) >> 2] = this._u32[(lastOffset + 8) >> 2]!;
    }

    this._u32[(ptr + 8) >> 2] = count - 1;
    return true;
  }

  private objectSet(target: Pointer, key: string, value: any) {
    this.resolvePtr(target.__ptr);
    const preScanLen = this.s_len;
    const preScanStart = this.s_start;

    for (let i = 0; i < preScanLen; i++) {
      const entryOffset = preScanStart + i * 12;
      const keyPtr = this._u32[entryOffset >> 2]!;
      if (this.readString(keyPtr) === key) {
        this._u32[(entryOffset + 4) >> 2] = TYPE_NULL;
        this._u32[(entryOffset + 8) >> 2] = 0;
        break;
      }
    }

    const valResult = this.writeValue(value);

    const valHandle = { __ptr: valResult.payload };
    const isValPtr = valResult.type >= TYPE_NUMBER;

    if (isValPtr) {
      this.tempRoots.push({ handle: valHandle, type: valResult.type });
    }

    try {
      this.resolvePtr(target.__ptr);
      let ptr = this.s_ptr;
      const entriesStart = this.s_start;
      const count = this.s_len;
      const cap = this.s_cap;

      for (let i = 0; i < count; i++) {
        const entryOffset = entriesStart + i * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;
        if (this.readString(keyPtr) === key) {
          this._u32[(entryOffset + 4) >> 2] = valResult.type;
          this._u32[(entryOffset + 8) >> 2] = valHandle.__ptr;
          return;
        }
      }

      const keyResult = this.writeValue(key);
      const keyHandle = { __ptr: keyResult.payload };
      this.tempRoots.push({ handle: keyHandle, type: TYPE_STRING });

      try {
        this.resolvePtr(target.__ptr);
        ptr = this.s_ptr;
        const currentCap = this.s_cap;
        const currentCount = this.s_len;

        if (currentCount >= currentCap) {
          const newCap = Math.max(currentCap * 2, 4);
          const newByteSize = 12 + newCap * 12;

          const newPtr = this.alloc(newByteSize);

          this.resolvePtr(target.__ptr);
          const oldDataStart = this.s_start;

          const idx = newPtr >> 2;
          this._u32[idx] = TYPE_OBJECT;
          this._u32[idx + 1] = newCap;
          this._u32[idx + 2] = currentCount + 1;

          this._u8.set(
            this._u8.subarray(oldDataStart, oldDataStart + currentCount * 12),
            newPtr + 12,
          );

          const entryOffset = newPtr + 12 + currentCount * 12;
          const eIdx = entryOffset >> 2;
          this._u32[eIdx] = keyHandle.__ptr;
          this._u32[eIdx + 1] = valResult.type;
          this._u32[eIdx + 2] = valHandle.__ptr;

          const pIdx = this.s_ptr >> 2;
          this._u32[pIdx] = TYPE_MOVED;
          this._u32[pIdx + 1] = newPtr;
        } else {
          const entryOffset = this.s_start + currentCount * 12;
          const eIdx = entryOffset >> 2;
          this._u32[eIdx] = keyHandle.__ptr;
          this._u32[eIdx + 1] = valResult.type;
          this._u32[eIdx + 2] = valHandle.__ptr;
          this._u32[(ptr + 8) >> 2] = currentCount + 1;
        }
      } finally {
        this.tempRoots.pop();
      }
    } finally {
      if (isValPtr) this.tempRoots.pop();
    }
  }

  // --- Array Methods Support ---

  private arrayEnsureCapacity(target: Pointer, minCap: number) {
    this.resolvePtr(target.__ptr);
    if (this.s_cap >= minCap) return;

    const oldCap = this.s_cap;
    const oldLen = this.s_len;
    const oldDataStart = this.s_start;

    const newCap = Math.max(oldCap * 2, minCap);
    const newByteSize = 12 + newCap * 8;

    const newPtr = this.alloc(newByteSize);

    // Re-resolve after alloc
    this.resolvePtr(target.__ptr);

    const idx = newPtr >> 2;
    this._u32[idx] = TYPE_ARRAY;
    this._u32[idx + 1] = newCap;
    this._u32[idx + 2] = oldLen;

    // Copy existing data
    this._u8.set(
      this._u8.subarray(oldDataStart, oldDataStart + oldLen * 8),
      newPtr + 12,
    );

    // Mark old as moved
    const pIdx = this.s_ptr >> 2;
    this._u32[pIdx] = TYPE_MOVED;
    this._u32[pIdx + 1] = newPtr;

    this.resolvePtr(target.__ptr);
  }

  private arraySpliceImpl(
    target: Pointer,
    start: number,
    deleteCount: number,
    items: any[] = [],
  ): any[] {
    this.resolvePtr(target.__ptr);
    const len = this.s_len;
    const actualStart = start < 0
      ? Math.max(len + start, 0)
      : Math.min(start, len);
    const actualDeleteCount = Math.min(
      Math.max(deleteCount, 0),
      len - actualStart,
    );

    // 1. Read deleted items to return
    const deletedItems: any[] = [];
    for (let i = 0; i < actualDeleteCount; i++) {
      const offset = this.s_start + (actualStart + i) * 8;
      deletedItems.push(this.readSlot(offset));
    }

    const insertCount = items.length;
    const delta = insertCount - actualDeleteCount;
    const newLen = len + delta;

    // 2. Ensure Capacity (Allocates new buffer if needed)
    this.arrayEnsureCapacity(target, newLen);
    // After this, this.s_start, s_ptr, s_cap are updated to potentially new location

    // 3. Move Memory (Shift tail)
    if (delta !== 0) {
      const tailCount = len - (actualStart + actualDeleteCount);
      const srcIdx = actualStart + actualDeleteCount;
      const destIdx = actualStart + insertCount;

      const srcOffset = this.s_start + srcIdx * 8;
      const destOffset = this.s_start + destIdx * 8;
      const byteLen = tailCount * 8;

      this._u8.copyWithin(destOffset, srcOffset, srcOffset + byteLen);
    }

    // 4. Insert Items
    for (let i = 0; i < insertCount; i++) {
      const val = items[i];
      const valResult = this.writeValue(val);
      const valHandle = { __ptr: valResult.payload };
      const isValPtr = valResult.type >= TYPE_NUMBER;

      if (isValPtr) {
        this.tempRoots.push({ handle: valHandle, type: valResult.type });
      }

      this.resolvePtr(target.__ptr);
      const offset = this.s_start + (actualStart + i) * 8;
      const oIdx = offset >> 2;
      this._u32[oIdx] = valResult.type;
      this._u32[oIdx + 1] = valHandle.__ptr;

      if (isValPtr) this.tempRoots.pop();
    }

    // 5. Update Length
    this._u32[(this.s_ptr + 8) >> 2] = newLen;
    this.s_len = newLen;

    return deletedItems;
  }

  /**
   * Helper to create a shallow JS Array containing Proxies or primitives
   * derived from the underlying buffer.
   */
  private toArrayShallow(ptr: number): any[] {
    this.resolvePtr(ptr);
    const len = this.s_len;
    const start = this.s_start;
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = this.readSlot(start + i * 8);
    }
    return result;
  }

  private arrayHandler: ProxyHandler<any> = {
    get: (target, prop, receiver) => {
      if (prop === CONSOLE_VIEW) return () => this.toConsoleView(target.__ptr);
      if (prop === toSerialized) return () => this[toSerialized]();
      if (prop === "__ptr") return target.__ptr;
      if (prop === "toJSON") return () => this.toJSON(target.__ptr);
      if (prop === Symbol.iterator) {
        return () => new ArrayCursor(this, target.__ptr);
      }

      this.resolvePtr(target.__ptr);
      if (target.__ptr === 0) return undefined;

      if (prop === "length") return this.s_len;

      // 1. Map common mutators to splice (efficient, no array copy)
      if (prop === "push") {
        return (...args: any[]) => {
          this.arraySpliceImpl(target, this.s_len, 0, args);
          return this.s_len;
        };
      }
      if (prop === "pop") {
        return () => {
          if (this.s_len === 0) return undefined;
          return this.arraySpliceImpl(target, this.s_len - 1, 1)[0];
        };
      }
      if (prop === "shift") {
        return () => {
          if (this.s_len === 0) return undefined;
          return this.arraySpliceImpl(target, 0, 1)[0];
        };
      }
      if (prop === "unshift") {
        return (...args: any[]) => {
          this.arraySpliceImpl(target, 0, 0, args);
          return this.s_len;
        };
      }
      if (prop === "splice") {
        return (start: number, deleteCount?: number, ...items: any[]) => {
          const len = this.s_len;
          const actualStart = start < 0 ? len + start : start;
          const maxDel = len - (actualStart < 0 ? 0 : actualStart);
          const actualDel = deleteCount === undefined
            ? maxDel
            : Math.min(Math.max(deleteCount, 0), maxDel);
          return this.arraySpliceImpl(target, actualStart, actualDel, items);
        };
      }

      // 2. Explicit ES2019 Flattening Methods
      if (prop === "flat") {
        return (depth: number = 1) => {
          const result: any[] = [];

          const flatten = (ptr: number, currentDepth: number) => {
            this.resolvePtr(ptr);
            const len = this.s_len;
            const start = this.s_start;
            // Capture start offset so loop is safe even if recursing changes s_ptr
            const captureStart = start;

            for (let i = 0; i < len; i++) {
              const offset = captureStart + i * 8;
              const type = this._u32[offset >> 2]!;
              const payload = this._u32[(offset + 4) >> 2]!;

              if (type === TYPE_ARRAY && currentDepth > 0) {
                flatten(payload, currentDepth - 1);
              } else {
                result.push(this.readSlot(offset));
              }
            }
          };

          flatten(target.__ptr, Math.floor(depth));
          return result;
        };
      }

      if (prop === "flatMap") {
        return (
          callback: (value: any, index: number, array: any[]) => any,
          thisArg?: any,
        ) => {
          const len = this.s_len;
          const start = this.s_start;
          const result: any[] = [];

          for (let i = 0; i < len; i++) {
            // Read value (resolves proxies if needed)
            const val = this.readSlot(start + i * 8);
            const mapped = callback.call(thisArg, val, i, receiver);

            if (Array.isArray(mapped)) {
              result.push(...mapped);
            } else {
              result.push(mapped);
            }
          }
          return result;
        };
      }

      // 3. Map in-place mutators via temporary array (Sort, Reverse, Fill, CopyWithin)
      if (
        typeof prop === "string" &&
        ["sort", "reverse", "fill", "copyWithin"].includes(prop)
      ) {
        return (...args: any[]) => {
          const arr = this.toArrayShallow(target.__ptr);
          (arr as any)[prop](...args);
          // Write back changes
          arr.forEach((v, i) => this.arraySet(target, i, v));
          return receiver;
        };
      }

      // 4. Fallback: Map all other read-only Array methods (map, filter, reduce, slice, join, etc.)
      if (typeof prop === "string" && prop in Array.prototype) {
        const nativeMethod = (Array.prototype as any)[prop];
        if (typeof nativeMethod === "function") {
          return (...args: any[]) => {
            const arr = this.toArrayShallow(target.__ptr);
            return nativeMethod.apply(arr, args);
          };
        }
      }

      // 5. Index Access
      if (typeof prop === "string") {
        const idx = Number(prop);
        if (!isNaN(idx)) {
          if (idx >= this.s_len) return undefined;
          return this.readSlot(this.s_start + idx * 8);
        }
      }

      return Reflect.get(target, prop, receiver);
    },
    set: (target, prop, value) => {
      if (prop === "length") {
        const newLen = Number(value);
        if (!isNaN(newLen) && newLen >= 0) {
          this.resolvePtr(target.__ptr);
          const currentLen = this.s_len;
          if (newLen < currentLen) {
            this.arraySpliceImpl(target, newLen, currentLen - newLen);
          } else if (newLen > currentLen) {
            this.arrayEnsureCapacity(target, newLen);
            this._u32[(this.s_ptr + 8) >> 2] = newLen;
          }
          return true;
        }
        return false;
      }

      const idx = Number(prop);
      if (!isNaN(idx)) {
        this.arraySet(target, idx, value);
        return true;
      }
      return false;
    },
    ownKeys: (target) => {
      this.resolvePtr(target.__ptr);
      const keys: string[] = [];
      for (let i = 0; i < this.s_len; i++) keys.push(String(i));
      keys.push("length");
      return keys;
    },
    getOwnPropertyDescriptor: (target, prop) => {
      if (prop === "length") {
        this.resolvePtr(target.__ptr);
        return {
          value: this.s_len,
          writable: true,
          enumerable: false,
          configurable: false,
        };
      }

      const idx = Number(prop);
      if (!isNaN(idx)) {
        this.resolvePtr(target.__ptr);
        if (idx >= 0 && idx < this.s_len) {
          const val = this.readSlot(this.s_start + idx * 8);
          return {
            value: val,
            enumerable: true,
            configurable: true,
            writable: true,
          };
        }
      }

      return undefined;
    },
  };

  private arraySet(target: Pointer, index: number, value: any) {
    this.resolvePtr(target.__ptr);
    if (index < this.s_len) {
      const offset = this.s_start + index * 8;
      this._u32[offset >> 2] = TYPE_NULL;
      this._u32[(offset + 4) >> 2] = 0;
    }

    const valResult = this.writeValue(value);
    const valHandle = { __ptr: valResult.payload };
    const isValPtr = valResult.type >= TYPE_NUMBER;

    if (isValPtr) {
      this.tempRoots.push({ handle: valHandle, type: valResult.type });
    }

    try {
      this.resolvePtr(target.__ptr);
      const ptr = this.s_ptr;
      const cap = this.s_cap;
      const len = this.s_len;

      if (index >= cap) {
        const newCap = Math.max(cap * 2, index + 1);
        const newByteSize = 12 + newCap * 8;

        const newPtr = this.alloc(newByteSize);

        this.resolvePtr(target.__ptr);
        const oldDataStart = this.s_start;

        const idx = newPtr >> 2;
        this._u32[idx] = TYPE_ARRAY;
        this._u32[idx + 1] = newCap;
        const newLen = Math.max(len, index + 1);
        this._u32[idx + 2] = newLen;

        const oldByteLen = len * 8;
        this._u8.set(
          this._u8.subarray(oldDataStart, oldDataStart + oldByteLen),
          newPtr + 12,
        );

        const pIdx = this.s_ptr >> 2;
        this._u32[pIdx] = TYPE_MOVED;
        this._u32[pIdx + 1] = newPtr;

        const offset = newPtr + 12 + index * 8;
        const oIdx = offset >> 2;
        this._u32[oIdx] = valResult.type;
        this._u32[oIdx + 1] = valHandle.__ptr;
        return;
      }

      const offset = ptr + 12 + index * 8;
      const oIdx = offset >> 2;
      this._u32[oIdx] = valResult.type;
      this._u32[oIdx + 1] = valHandle.__ptr;

      if (index >= len) {
        this._u32[(ptr + 8) >> 2] = index + 1;
      }
    } finally {
      if (isValPtr) this.tempRoots.pop();
    }
  }

  [toSerialized]() {
    return {
      value: this.buffer,
      transfer: [],
      className: SharedJsonBufferImpl.name,
    };
  }

  static [toDeserialized](
    data: ReturnType<
      SharedJsonBufferImpl<any>[typeof toSerialized]
    >["value"],
  ) {
    return new SharedJsonBufferImpl(null as any, data);
  }
}

class ArrayCursor implements IterableIterator<any> {
  private index = 0;
  private len: number;
  private start: number;
  private flyweightProxy: any;
  private target = { __ptr: 0 };
  private result: IteratorResult<any>;

  constructor(private buffer: SharedJsonBufferImpl<any>, ptr: number) {
    buffer.resolvePtr(ptr);
    this.len = buffer.s_len;
    this.start = buffer.s_start;

    const type = buffer._u32[buffer.s_ptr >> 2]!;
    if (type !== TYPE_ARRAY) {
      throw new Error("Iterator must be used on an Array");
    }

    this.flyweightProxy = new Proxy(this.target, buffer.objectHandler);
    this.result = { done: false, value: this.flyweightProxy };
  }

  [Symbol.iterator]() {
    return this;
  }

  next(): IteratorResult<any> {
    if (this.index >= this.len) {
      this.result.done = true;
      this.result.value = undefined;
      return this.result;
    }

    const offset = this.start + this.index * 8;
    const itemType = this.buffer._u32[offset >> 2]!;
    const itemPayload = this.buffer._u32[(offset + 4) >> 2]!;

    this.index++;

    if (itemType === TYPE_OBJECT || itemType === TYPE_ARRAY) {
      this.target.__ptr = itemPayload;
      return this.result;
    }

    this.result.value = this.buffer.readSlot(offset);
    return this.result;
  }
}

export const SharedJsonBuffer = SharedJsonBufferImpl as {
  new <T extends Proxyable>(
    initial: T,
    options?: { size?: number },
  ): SharedJsonBufferImpl<T> & T;
  new <T extends Proxyable>(
    initial: T,
    buffer: SharedArrayBuffer,
  ): SharedJsonBufferImpl<T> & T;
  [toDeserialized](data: any): any;
};

export type SharedJsonBuffer<T extends Proxyable> = SharedJsonBufferImpl<T> & T;
