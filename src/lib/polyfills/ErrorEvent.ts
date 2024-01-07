import Event from "./Event.ts";

export default class ErrorEvent extends Event implements globalThis.ErrorEvent {
  colno: number = 0;
  error: any;
  filename: string = "";
  lineno: number = 0;
  message: string = "";

  constructor(init: ErrorEventInit) {
    super("error");
    Object.assign(this, init);
  }
}
