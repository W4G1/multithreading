import Event from "./Event.ts";

export default class PromiseRejectionEvent
  extends Event
  implements globalThis.PromiseRejectionEvent
{
  promise!: Promise<any>;
  reason!: any;

  constructor(init: PromiseRejectionEventInit) {
    super("unhandledrejection");
    Object.assign(this, init);
  }
}
