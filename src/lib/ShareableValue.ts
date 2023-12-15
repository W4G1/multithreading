import { UnclaimStatement } from "./UnclaimStatement";

export class ShareableValue<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }

  private [Symbol.iterator]() {
    return [new UnclaimStatement(this)][Symbol.iterator]();
  }
}
