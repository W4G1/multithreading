/**
 * Parses source code and patches dynamic imports to resolve relative
 * to a specific callerLocation using import.meta.url.
 */
export function patchDynamicImports(
  code: string,
  callerLocation: string,
): string {
  // Normalize callerLocation to be a valid URL.
  let normalizedCaller = callerLocation;

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalizedCaller)) {
    normalizedCaller = normalizedCaller.replace(/\\/g, "/");
    if (!normalizedCaller.startsWith("/")) {
      normalizedCaller = "/" + normalizedCaller;
    }
    normalizedCaller = "file://" + normalizedCaller;
  }

  // Find all occurrences of "import("
  const importStartPattern = /\bimport\s*\(/g;

  const replacements: { start: number; end: number; text: string }[] = [];
  let match: RegExpExecArray | null;

  // Iterate through matches
  while ((match = importStartPattern.exec(code)) !== null) {
    const importStartIndex = match.index;
    const openParenIndex = importStartIndex + match[0].length - 1;

    // Extract the first argument safely
    const argBounds = findArgumentBounds(code, openParenIndex + 1);

    if (argBounds) {
      const { start, end } = argBounds;
      const originalArgument = code.slice(start, end);

      const isStringLiteral = /^["'`]/.test(originalArgument);

      if (isStringLiteral) {
        const content = originalArgument.slice(1, -1);

        // Check if it looks like a relative/absolute path or URL.
        // Matches: ./, ../, /, \, or anything starting with a protocol (http:)
        const isExplicitPath = /^\.{0,2}[/\\]|^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(
          content,
        );

        if (!isExplicitPath) {
          continue;
        }
      }

      // Construct replacement
      const safeCallerLoc = JSON.stringify(normalizedCaller);

      const newArgument =
        `new URL(${originalArgument}, new URL(${safeCallerLoc}, import.meta.url).href).href`;

      replacements.push({
        start: start,
        end: end,
        text: newArgument,
      });
    }
  }

  // Apply replacements in reverse order
  replacements.sort((a, b) => b.start - a.start);

  let modifiedCode = code;
  for (const rep of replacements) {
    const before = modifiedCode.slice(0, rep.start);
    const after = modifiedCode.slice(rep.end);
    modifiedCode = before + rep.text + after;
  }

  return modifiedCode;
}

/**
 * Helper: Scans forward from a specific index to find the bounds of the
 * ACTUAL code argument, ignoring surrounding whitespace and comments.
 */
function findArgumentBounds(
  code: string,
  startIndex: number,
): { start: number; end: number } | null {
  let index = startIndex;
  const len = code.length;

  let inString: "'" | '"' | "`" | null = null;
  let inComment: "//" | "/*" | null = null;
  let parenDepth = 0;

  // We track the start and end of "Meaningful Code".
  // Meaningful = anything that isn't whitespace or a comment.
  let argStart = -1;
  let argEnd = -1;

  for (; index < len; index++) {
    const char = code[index]!;
    const nextChar = code[index + 1];

    // --- 1. HANDLE STRINGS ---
    if (inString) {
      if (char === "\\" && index + 1 < len) {
        index++; // Skip escaped char
        // Escaped chars are meaningful, update end
        argEnd = index + 1;
        continue;
      }
      if (char === inString) {
        inString = null;
      }
      // Everything inside a string is meaningful
      if (argStart === -1) argStart = index;
      argEnd = index + 1;
      continue;
    }

    // --- 2. HANDLE COMMENTS ---
    if (inComment) {
      if (inComment === "//" && char === "\n") {
        inComment = null;
      } else if (inComment === "/*" && char === "*" && nextChar === "/") {
        inComment = null;
        index++; // Skip the /
      }
      // Comments are NOT meaningful (we do not update argStart/argEnd)
      continue;
    }

    // --- 3. DETECT START OF STRINGS ---
    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      if (argStart === -1) argStart = index;
      argEnd = index + 1;
      continue;
    }

    // --- 4. DETECT START OF COMMENTS ---
    if (char === "/" && nextChar === "/") {
      inComment = "//";
      index++;
      continue;
    }
    if (char === "/" && nextChar === "*") {
      inComment = "/*";
      index++;
      continue;
    }

    // --- 5. HANDLE SYNTAX STRUCTURE ---
    if (char === "(") {
      parenDepth++;
      // Parenthesis inside the expression are meaningful code
      if (argStart === -1) argStart = index;
      argEnd = index + 1;
    } else if (char === ")") {
      if (parenDepth === 0) {
        // HIT THE END OF IMPORT
        if (argStart === -1) return null; // Empty import()
        return { start: argStart, end: argEnd };
      }
      parenDepth--;
      if (argStart === -1) argStart = index;
      argEnd = index + 1;
    } else if (char === ",") {
      if (parenDepth === 0) {
        // HIT THE END OF FIRST ARGUMENT
        if (argStart === -1) return null; // Empty?
        return { start: argStart, end: argEnd };
      }
      // Commas inside nested function calls are meaningful
      if (argStart === -1) argStart = index;
      argEnd = index + 1;
    } else {
      // --- 6. GENERIC CHARACTERS ---
      // If it is NOT whitespace, it is meaningful code.
      if (!/\s/.test(char)) {
        if (argStart === -1) argStart = index;
        argEnd = index + 1;
      }
    }
  }

  return null;
}
