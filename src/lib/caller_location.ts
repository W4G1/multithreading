export interface CallerLocation {
  filePath: string;
  line: number; // 0-based index
  column: number; // 0-based index
}

/**
 * Analyzes the stack trace to find the file and coordinates
 * where this function was called.
 */
export function getCallerLocation(): CallerLocation {
  // Default internal files to ignore
  const internalFiles = [
    "caller_location.ts",
    "caller_location.js",
    "lib.ts",
    "lib.js",
    "internal",
    "node_modules",
    "native",
  ];

  const stack = new Error().stack!;
  const lines = stack.split("\n");

  let callerLine: string | undefined;

  // Iterate to find the first 'outsider'
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.trim() === "Error") continue;

    // Check if this line belongs to the library
    const isInternal = internalFiles.some((file) => line.includes(file));

    if (!isInternal) {
      callerLine = line;
      break;
    }
  }

  if (!callerLine) {
    throw new Error("Could not find caller line in stack trace");
  }

  // Handle Bun/Deno/Node stack format differences
  const matchParen = callerLine.match(/\((.*)\)/);
  let pathWithCoords = matchParen
    ? matchParen[1]!
    : callerLine.replace(/^\s*at\s+/, "").trim();

  pathWithCoords = pathWithCoords.replace(/^async\s+/, "");

  // Extract coordinates (Format is usually path/to/file.ts:line:col)
  const coordMatch = pathWithCoords.match(/:(\d+):(\d+)$/);

  if (!coordMatch) {
    throw new Error(`Could not parse coordinates from: ${callerLine}`);
  }

  const filePath = pathWithCoords.replace(/:\d+:\d+$/, "");

  // Convert 1-based stack trace coords to 0-based AST coords
  return {
    filePath,
    line: Number(coordMatch[1]) - 1,
    column: Number(coordMatch[2]) - 1,
  };
}
