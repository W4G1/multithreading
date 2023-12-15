export class ThreadReferenceError extends Error {
  constructor(message?: string) {
    super(message);

    const variable = message?.split(" ")[0];

    this.message = `${variable} is not defined. Did you forget to add it at the top of your function?`;
    this.name = this.constructor.name;

    // console.log(typeof super.stack, super.stack?.length);

    // super.name = this.name;
    // super.message = `${variable} is not defined. Did you forget to add it at the top of your function?`;
    // super.stack = "";

    console.log("[BEGIN STACK]");
    console.log(decodeURIComponent(this.stack));
    console.log("[END STACK]");
  }
}
// ReferenceError [Error]: a is not defined
