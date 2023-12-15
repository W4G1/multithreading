// declare var self: WorkerGlobalScope;

import { GLOBAL_FUNCTION_NAME } from "../constants";
import { ShareableValue } from "./ShareableValue";
import { UnclaimStatement } from "./UnclaimStatement";
import { ThreadReferenceError } from "./errors/ThreadReferenceError";
import { deserialize } from "./serialize";

globalThis.onmessage = async (e) => {
  const variables = deserialize(e.data.variables);

  Object.assign(globalThis, variables);

  const gen = globalThis[GLOBAL_FUNCTION_NAME](...e.data.args);

  const { value: context } = await gen.next();

  // try {
  while (true) {
    const { value, done } = await gen.next();

    if (done) break;

    if (value instanceof ShareableValue) {
      console.log("[CLAIM]", value);
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (value instanceof UnclaimStatement) {
      console.log("[UNCLAIM]", value);
    }
  }
  // } catch (error) {
  //   if (error instanceof ReferenceError) {
  //     const err = new ThreadReferenceError(error.message);
  //   }
  // }

  setTimeout(() => {
    globalThis.close();
  }, 0);
};
