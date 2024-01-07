const colorGray = "\x1b[90m";
const colorRed = "\x1b[31m";
const colorCyan = "\x1b[36m";
const colorReset = "\x1b[39m";

export function getErrorPreview(error: Error, code: string, pid: number) {
  const [message, ...serializedStackFrames] = error.stack!.split("\n");

  // Check if error originates from inside the user function
  const stackFrame = serializedStackFrames.find((frame) =>
    frame.includes("data:application/javascript;base64")
  );

  if (!stackFrame) {
    return error.stack!;
  }

  // Split at the comma of data:application/javascript;base64,
  const [functionPart, tracePart] = stackFrame.split(",");

  const [encodedBodyPart, lineNumberStr, columnNumberStr] =
    tracePart.split(":");

  const lineNumber = parseInt(lineNumberStr);
  const columnNumber = parseInt(columnNumberStr);

  const codeLines = code.split(/\r?\n/);

  const amountOfPreviousLines = Math.min(3, lineNumber - 1);
  const amountOfNextLines = 2;

  const previewLines = codeLines.slice(
    lineNumber - (amountOfPreviousLines + 1),
    lineNumber + amountOfNextLines
  );

  const previousLineLength =
    codeLines[lineNumber - 1].trimEnd().length - columnNumber;

  previewLines.splice(
    amountOfPreviousLines + 1,
    0,
    colorRed +
      " ".repeat(columnNumber - 1) +
      "^".repeat(previousLineLength) +
      " " +
      // "Error" +
      message +
      colorGray
  );

  const index = serializedStackFrames.indexOf(stackFrame);
  serializedStackFrames[index] =
    `    at ${colorCyan}<Thread_${pid}>${colorReset}\n` +
    colorGray +
    "    " +
    previewLines.join("\n    ") +
    colorReset;

  // return message + "\n" + serializedStackFrames.slice(0, index + 1).join("\n");
  return (
    message.split(":").slice(1).join(":").trim() +
    "\n" +
    serializedStackFrames.slice(0, index + 1).join("\n")
  );
}
