const colorRed = "\x1b[31m";
const colorReset = "\x1b[39m";

export function getErrorPreview(error: Error) {
  const [message, ...serializedStackFrames] = error.stack!.split("\n");

  const stackFrame = decodeURIComponent(serializedStackFrames[0]);

  const [functionPart, ...otherParts] = stackFrame.split(
    " (data:text/javascript;charset=utf-8,"
  );

  const other = otherParts.join();
  const codeLines = other.split(/\r?\n/);
  const lastLine = codeLines.pop()!;

  const [lineNumber, columnNumber] = lastLine
    .slice(0, -1)
    .split(":")
    .slice(-2)
    .map((n) => parseInt(n));

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
      message +
      colorReset
  );

  const preview =
    `${error.name} ${functionPart.trim()}:\n\n` + previewLines.join("\n");

  return preview;
}
