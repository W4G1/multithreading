import Event from "./Event.ts";

const EVENTS = Symbol.for("events");

export default class EventTarget implements globalThis.EventTarget {
  constructor() {
    Object.defineProperty(this, EVENTS, {
      value: new Map(),
    });
  }
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions | undefined
  ): void;
  addEventListener(type: unknown, callback: unknown, options?: unknown): void {
    let events = this[EVENTS].get(type);
    if (!events) this[EVENTS].set(type, (events = []));
    events.push(callback);
  }

  dispatchEvent(event: Event): boolean;
  dispatchEvent(event: unknown): boolean {
    event.target = event.currentTarget = this;
    if (this["on" + event.type]) {
      try {
        this["on" + event.type](event);
      } catch (err) {
        console.error(err);
      }
    }
    const list = this[EVENTS].get(event.type);
    if (list == null) return false;
    list.forEach((handler) => {
      try {
        handler.call(this, event);
      } catch (err) {
        console.error(err);
      }
    });

    return false;
  }

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions | undefined
  ): void;
  removeEventListener(
    type: unknown,
    callback: unknown,
    options?: unknown
  ): void {
    let events = this[EVENTS].get(type);
    if (events) {
      const index = events.indexOf(callback);
      if (index !== -1) events.splice(index, 1);
    }
  }
}
