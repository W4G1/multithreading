import EventTarget from "./EventTarget";

export default class Event implements globalThis.Event {
  bubbles: boolean = false;
  cancelBubble: boolean = false;
  cancelable: boolean = false;
  composed: boolean = false;
  currentTarget: EventTarget | null = null;
  defaultPrevented: boolean = false;
  eventPhase: number = 0;
  isTrusted: boolean = false;
  returnValue: boolean = false;
  srcElement: EventTarget | null = null;
  target: EventTarget | null = null;
  timeStamp: number;
  type: string;
  composedPath(): EventTarget[];
  composedPath(): EventTarget[] {
    throw new Error("Method not implemented.");
  }
  initEvent(
    type: string,
    bubbles?: boolean | undefined,
    cancelable?: boolean | undefined
  ): void;
  initEvent(
    type: string,
    bubbles?: boolean | undefined,
    cancelable?: boolean | undefined
  ): void;
  initEvent(type: unknown, bubbles?: unknown, cancelable?: unknown): void {
    throw new Error("Method not implemented.");
  }
  preventDefault(): void;
  preventDefault(): void {
    // throw new Error("Method not implemented.");
  }
  stopImmediatePropagation(): void;
  stopImmediatePropagation(): void {
    // throw new Error("Method not implemented.");
  }
  stopPropagation(): void;
  stopPropagation(): void {
    // throw new Error("Method not implemented.");
  }
  NONE: 0 = 0;
  CAPTURING_PHASE: 1 = 1;
  AT_TARGET: 2 = 2;
  BUBBLING_PHASE: 3 = 3;

  // Custom
  data: any;

  constructor(type: string, target: EventTarget | null = null) {
    this.type = type;
    this.timeStamp = Date.now();
  }
}
