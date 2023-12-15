import { ShareableValue } from "./ShareableValue";

export class UnclaimStatement<T> {
  sharedValue: ShareableValue<T>;

  constructor(sharedValue: ShareableValue<T>) {
    this.sharedValue = sharedValue;
  }
}
