import {
  register,
  type Serializable,
  toDeserialized,
  toSerialized,
} from "./shared.ts";

export type Proxyable = Record<string | symbol, any> | any[];

const OFFSET_FREE_PTR = 0;
const OFFSET_ROOT = 4;
const HEADER_SIZE = 8;

const TYPE_NULL = 0;
const TYPE_TRUE = 1;
const TYPE_FALSE = 2;
const TYPE_NUMBER = 3;
const TYPE_STRING = 4;
const TYPE_OBJECT = 5;
const TYPE_ARRAY = 6;
const TYPE_MOVED = 0xffffffff;

// --- Optimization: Global Scratch Variables (The "Register" approach) ---
// V8 can optimize these into CPU registers more easily than object properties.
let scratch_ptr = 0;
let scratch_cap = 0;
let scratch_len = 0;
let scratch_start = 0;

// Property Hint Cache (Shape Heuristics)
const propertyHints = new Map<string, number>();

class SharedJsonBufferImpl<T extends Proxyable> implements Serializable {
  static {
    register(this);
  }

  public _u32!: Uint32Array;
  public _view!: DataView;
  public _textDecoder = new TextDecoder();
  public _stringCache = new Map<number, string>();

  private buffer!: SharedArrayBuffer;
  private u8!: Uint8Array;
  private textEncoder = new TextEncoder();
  private proxyCache = new Map<number, any>();

  constructor(initial: T, options?: { size?: number });
  constructor(initial: T, buffer: SharedArrayBuffer);
  constructor(
    obj: T,
    optionsOrBuffer?: SharedArrayBuffer | { size?: number },
  ) {
    if (optionsOrBuffer instanceof SharedArrayBuffer) {
      this.buffer = optionsOrBuffer;
      this.initViews();
    } else {
      const size = optionsOrBuffer?.size || 1024 * 64;
      this.buffer = new SharedArrayBuffer(size);
      this.initViews();

      Atomics.store(this._u32, OFFSET_FREE_PTR / 4, HEADER_SIZE);

      const isArr = Array.isArray(obj);
      const initialKeys = isArr ? obj.length : Object.keys(obj).length;
      const rootPtr = isArr
        ? this.allocArray(initialKeys)
        : this.allocObject(initialKeys);

      Atomics.store(this._u32, OFFSET_ROOT / 4, rootPtr);
      this.writeInitial(rootPtr, obj);
    }

    return this.getRootProxy();
  }

  private initViews() {
    this._view = new DataView(this.buffer);
    this._u32 = new Uint32Array(this.buffer);
    this.u8 = new Uint8Array(this.buffer);
  }

  private getRootProxy(): any {
    const rootPtr = Atomics.load(this._u32, OFFSET_ROOT / 4);
    return this.getProxyForPtr(rootPtr);
  }

  private alloc(byteSize: number): number {
    const idx = OFFSET_FREE_PTR >> 2;
    const currentPtr = Atomics.load(this._u32, idx);
    const nextPtr = currentPtr + byteSize;
    const alignedNext = (nextPtr + 3) & ~3;

    if (alignedNext > this.buffer.byteLength) {
      throw new Error(
        `SharedJsonBuffer OOM: Used ${alignedNext} of ${this.buffer.byteLength}`,
      );
    }

    Atomics.store(this._u32, idx, alignedNext);
    return currentPtr;
  }

  // --- HOT PATH: Pointer Resolution ---
  public resolvePtr(ptr: number) {
    let curr = ptr;

    // Fast Path: Object hasn't moved (No loop)
    let type = this._u32[curr >> 2]!;

    if (type !== TYPE_MOVED) {
      scratch_ptr = curr;
      scratch_cap = this._u32[(curr + 4) >> 2]!;
      scratch_len = this._u32[(curr + 8) >> 2]!;
      scratch_start = curr + 12;
      return;
    }

    // Slow Path: Chase pointers
    while (true) {
      if (type === TYPE_MOVED) {
        curr = this._u32[(curr + 4) >> 2]!;
        type = this._u32[curr >> 2]!;
        continue;
      }
      scratch_ptr = curr;
      scratch_cap = this._u32[(curr + 4) >> 2]!;
      scratch_len = this._u32[(curr + 8) >> 2]!;
      scratch_start = curr + 12;
      return;
    }
  }

  public readSlot(offset: number): any {
    const type = this._u32[offset >> 2]!;
    const payload = this._u32[(offset + 4) >> 2]!;

    if (type === TYPE_NUMBER) {
      return this._view.getFloat64(payload, true);
    }

    switch (type) {
      case TYPE_TRUE:
        return true;
      case TYPE_FALSE:
        return false;
      case TYPE_NULL:
        return null;
      case TYPE_STRING: {
        if (this._stringCache.has(payload)) {
          return this._stringCache.get(payload);
        }
        const len = this._u32[payload >> 2];
        const strBytes = new Uint8Array(this.buffer, payload + 4, len);
        const str = this._textDecoder.decode(strBytes);
        this._stringCache.set(payload, str);
        return str;
      }
      case TYPE_OBJECT:
      case TYPE_ARRAY:
        return this.getProxyForPtr(payload);
      default:
        return undefined;
    }
  }

  private writeValue(value: any): { type: number; payload: number } {
    if (value === null) return { type: TYPE_NULL, payload: 0 };
    if (value === undefined) return { type: TYPE_NULL, payload: 0 };
    if (value === true) return { type: TYPE_TRUE, payload: 0 };
    if (value === false) return { type: TYPE_FALSE, payload: 0 };

    if (typeof value === "number") {
      const ptr = this.alloc(8);
      this._view.setFloat64(ptr, value, true);
      return { type: TYPE_NUMBER, payload: ptr };
    }

    if (typeof value === "string") {
      const encoded = this.textEncoder.encode(value);
      const len = encoded.byteLength;
      const ptr = this.alloc(4 + len);
      this._u32[ptr >> 2] = len;
      this.u8.set(encoded, ptr + 4);
      return { type: TYPE_STRING, payload: ptr };
    }

    if (Array.isArray(value)) {
      const ptr = this.allocArray(value.length);
      this.writeInitial(ptr, value);
      return { type: TYPE_ARRAY, payload: ptr };
    }

    if (typeof value === "object") {
      const keys = Object.keys(value);
      const ptr = this.allocObject(keys.length);
      this.writeInitial(ptr, value);
      return { type: TYPE_OBJECT, payload: ptr };
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

  private writeInitial(ptr: number, data: any) {
    if (Array.isArray(data)) {
      data.forEach((v, i) => this.arraySet(ptr, i, v));
    } else {
      Object.entries(data).forEach(([k, v]) => this.objectSet(ptr, k, v));
    }
  }

  // --- Proxy Logic ---

  public objectHandler: ProxyHandler<any> = {
    get: (target, prop, receiver) => {
      if (typeof prop === "symbol") {
        if (prop === toSerialized) return () => this[toSerialized]();
        if (prop === Symbol.iterator) return undefined;
        return Reflect.get(target, prop, receiver);
      }
      if (prop === "__ptr") return target.__ptr;
      if (prop === "toJSON") return () => this.toJSON(target.__ptr);

      // Inline Resolve
      const ptr = target.__ptr;
      const type = this._u32[ptr >> 2]!;

      // We manually read if not moved to avoid function call overhead
      if (type !== TYPE_MOVED) {
        scratch_len = this._u32[(ptr + 8) >> 2]!;
        scratch_start = ptr + 12;
      } else {
        this.resolvePtr(ptr);
      }
      // Note: scratch variables are now populated

      // 1. SLOT CACHING
      const hint = propertyHints.get(prop);
      if (hint !== undefined && hint < scratch_len) {
        const entryOffset = scratch_start + (hint * 12);
        const keyPtr = this._u32[entryOffset >> 2]!;

        let keyStr = this._stringCache.get(keyPtr);
        if (!keyStr) {
          const kLen = this._u32[keyPtr >> 2];
          keyStr = this._textDecoder.decode(
            new Uint8Array(this.buffer, keyPtr + 4, kLen),
          );
          this._stringCache.set(keyPtr, keyStr);
        }

        if (keyStr === prop) {
          return this.readSlot(entryOffset + 4);
        }
      }

      // 2. Linear Scan
      for (let i = 0; i < scratch_len; i++) {
        const entryOffset = scratch_start + i * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;

        let key = this._stringCache.get(keyPtr);
        if (!key) {
          const kLen = this._u32[keyPtr >> 2];
          key = this._textDecoder.decode(
            new Uint8Array(this.buffer, keyPtr + 4, kLen),
          );
          this._stringCache.set(keyPtr, key);
        }

        if (key === prop) {
          propertyHints.set(prop, i);
          return this.readSlot(entryOffset + 4);
        }
      }
      return undefined;
    },

    set: (target, prop, value) => {
      if (typeof prop === "symbol") return false;
      this.objectSet(target.__ptr, prop, value);
      return true;
    },

    ownKeys: (target) => {
      this.resolvePtr(target.__ptr);
      const keys: string[] = [];
      for (let i = 0; i < scratch_len; i++) {
        const keyPtr = this._u32[(scratch_start + i * 12) >> 2]!;
        let key = this._stringCache.get(keyPtr);
        if (!key) {
          const kLen = this._u32[keyPtr >> 2];
          key = this._textDecoder.decode(
            new Uint8Array(this.buffer, keyPtr + 4, kLen),
          );
          this._stringCache.set(keyPtr, key);
        }
        keys.push(key);
      }
      return keys;
    },

    getOwnPropertyDescriptor: (target, prop) => {
      const value = this.objectHandler.get!(target, prop, target);
      if (value === undefined) return undefined;
      return { enumerable: true, configurable: true, writable: true, value };
    },
  };

  private getProxyForPtr(ptr: number): any {
    this.resolvePtr(ptr);
    // use scratch_ptr (which is the resolved pointer)
    const resolvedPtr = scratch_ptr;

    if (this.proxyCache.has(resolvedPtr)) {
      return this.proxyCache.get(resolvedPtr);
    }

    const type = this._u32[resolvedPtr >> 2]!;
    let target: any;
    let proxy: any;

    if (type === TYPE_ARRAY) {
      target = [];
      Object.defineProperty(target, "__ptr", {
        value: resolvedPtr,
        writable: true,
        configurable: true,
      });
      proxy = new Proxy(target, this.arrayHandler);
    } else {
      target = {};
      Object.defineProperty(target, "__ptr", {
        value: resolvedPtr,
        writable: true,
        configurable: true,
      });
      proxy = new Proxy(target, this.objectHandler);
    }

    this.proxyCache.set(resolvedPtr, proxy);
    return proxy;
  }

  private toJSON(ptr: number): any {
    this.resolvePtr(ptr);
    const type = this._u32[scratch_ptr >> 2]!;

    if (type === TYPE_ARRAY) {
      const arr = new Array(scratch_len);
      for (let i = 0; i < scratch_len; i++) {
        arr[i] = this.readSlot(scratch_start + i * 8);
      }
      return arr;
    } else {
      const obj: any = {};
      for (let i = 0; i < scratch_len; i++) {
        const entryOffset = scratch_start + i * 12;
        const keyPtr = this._u32[entryOffset >> 2]!;
        let key = this._stringCache.get(keyPtr);
        if (!key) {
          const kLen = this._u32[keyPtr >> 2];
          key = this._textDecoder.decode(
            new Uint8Array(this.buffer, keyPtr + 4, kLen),
          );
          this._stringCache.set(keyPtr, key);
        }
        obj[key] = this.readSlot(entryOffset + 4);
      }
      return obj;
    }
  }

  private objectSet(origPtr: number, key: string, value: any) {
    this.resolvePtr(origPtr);
    // Capture scratch values locally in case they change during alloc
    const ptr = scratch_ptr;
    const cap = scratch_cap;
    const count = scratch_len;
    const entriesStart = ptr + 12;

    const { type, payload } = this.writeValue(value);

    for (let i = 0; i < count; i++) {
      const entryOffset = entriesStart + i * 12;
      const keyPtr = this._u32[entryOffset >> 2]!;
      let keyStr = this._stringCache.get(keyPtr);
      if (!keyStr) {
        const kLen = this._u32[keyPtr >> 2];
        keyStr = this._textDecoder.decode(
          new Uint8Array(this.buffer, keyPtr + 4, kLen),
        );
        this._stringCache.set(keyPtr, keyStr);
      }
      if (keyStr === key) {
        this._u32[(entryOffset + 4) >> 2] = type;
        this._u32[(entryOffset + 8) >> 2] = payload;
        return;
      }
    }

    if (count >= cap) {
      const newCap = Math.max(cap * 2, 4);
      const newByteSize = 12 + newCap * 12;
      const newPtr = this.alloc(newByteSize);

      const idx = newPtr >> 2;
      this._u32[idx] = TYPE_OBJECT;
      this._u32[idx + 1] = newCap;
      this._u32[idx + 2] = count + 1;

      const oldData = new Uint8Array(this.buffer, entriesStart, count * 12);
      new Uint8Array(this.buffer, newPtr + 12).set(oldData);

      const entryOffset = newPtr + 12 + count * 12;
      const { payload: kPtr } = this.writeValue(key);
      const eIdx = entryOffset >> 2;
      this._u32[eIdx] = kPtr;
      this._u32[eIdx + 1] = type;
      this._u32[eIdx + 2] = payload;

      const pIdx = ptr >> 2;
      this._u32[pIdx] = TYPE_MOVED;
      this._u32[pIdx + 1] = newPtr;
    } else {
      const entryOffset = entriesStart + count * 12;
      const { payload: kPtr } = this.writeValue(key);
      const eIdx = entryOffset >> 2;
      this._u32[eIdx] = kPtr;
      this._u32[eIdx + 1] = type;
      this._u32[eIdx + 2] = payload;
      this._u32[(ptr + 8) >> 2] = count + 1;
    }
  }

  private arrayHandler: ProxyHandler<any> = {
    get: (target, prop, receiver) => {
      if (prop === toSerialized) return () => this[toSerialized]();
      if (prop === "__ptr") return target.__ptr;
      if (prop === "toJSON") return () => this.toJSON(target.__ptr);
      if (prop === Symbol.iterator) {
        return () => new ArrayCursor(this, target.__ptr);
      }

      this.resolvePtr(target.__ptr);

      if (prop === "length") return scratch_len;

      if (typeof prop === "string" && !isNaN(Number(prop))) {
        const idx = Number(prop);
        if (idx >= scratch_len) return undefined;
        return this.readSlot(scratch_start + idx * 8);
      }

      if (prop === "push") {
        return (...args: any[]) => {
          const currentLen = this.arrayHandler.get!(target, "length", target);
          args.forEach((a, i) =>
            this.arraySet(target.__ptr, currentLen + i, a)
          );
          return currentLen + args.length;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
    set: (target, prop, value) => {
      if (prop === "length") return false;
      if (typeof prop === "string" && !isNaN(Number(prop))) {
        this.arraySet(target.__ptr, Number(prop), value);
        return true;
      }
      return false;
    },
    ownKeys: (target) => {
      this.resolvePtr(target.__ptr);
      const keys: string[] = [];
      for (let i = 0; i < scratch_len; i++) keys.push(String(i));
      keys.push("length");
      return keys;
    },
    getOwnPropertyDescriptor: (target, prop) => {
      if (prop === "length") {
        this.resolvePtr(target.__ptr);
        return {
          value: scratch_len,
          writable: true,
          enumerable: false,
          configurable: false,
        };
      }
      if (typeof prop === "string" && !isNaN(Number(prop))) {
        const val = this.arrayHandler.get!(target, prop, target);
        return {
          value: val,
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      return undefined;
    },
  };

  private arraySet(origPtr: number, index: number, value: any) {
    this.resolvePtr(origPtr);
    const ptr = scratch_ptr;
    const cap = scratch_cap;
    const len = scratch_len;

    if (index >= cap) {
      const newCap = Math.max(cap * 2, index + 1);
      const newByteSize = 12 + newCap * 8;
      const newPtr = this.alloc(newByteSize);

      const idx = newPtr >> 2;
      this._u32[idx] = TYPE_ARRAY;
      this._u32[idx + 1] = newCap;
      const newLen = Math.max(len, index + 1);
      this._u32[idx + 2] = newLen;

      const oldByteLen = len * 8;
      const oldData = new Uint8Array(this.buffer, ptr + 12, oldByteLen);
      new Uint8Array(this.buffer, newPtr + 12).set(oldData);

      const pIdx = ptr >> 2;
      this._u32[pIdx] = TYPE_MOVED;
      this._u32[pIdx + 1] = newPtr;

      this.arraySet(origPtr, index, value);
      return;
    }

    const { type, payload } = this.writeValue(value);
    const offset = ptr + 12 + index * 8;
    const oIdx = offset >> 2;
    this._u32[oIdx] = type;
    this._u32[oIdx + 1] = payload;

    if (index >= len) {
      this._u32[(ptr + 8) >> 2] = index + 1;
    }
  }

  [toSerialized]() {
    return {
      value: { buffer: this.buffer },
      transfer: [],
      className: SharedJsonBufferImpl.name,
    };
  }

  static [toDeserialized](
    data: ReturnType<
      SharedJsonBufferImpl<any>[typeof toSerialized]
    >["value"],
  ) {
    return new SharedJsonBufferImpl(null as any, data.buffer);
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

    // Read from globals
    const resolvedPtr = scratch_ptr;
    this.len = scratch_len;
    this.start = scratch_start;

    const type = buffer._u32[resolvedPtr >> 2];
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
