/**
 * Parses source code and patches dynamic imports to resolve relative
 * to a specific callerLocation using import.meta.url.
 * * This uses a state-machine approach to correctly ignore parentheses
 * inside strings, templates, and comments.
 */
export function patchDynamicImports(
  code: string,
  callerLocation: string,
): string {
  // 0. Normalize callerLocation to be a valid URL.
  // The Error "Invalid URL" happens because `new URL(path, base)` requires `base`
  // to be a valid URL (e.g. file:///...), but raw paths (/home/...) are not.
  let normalizedCaller = callerLocation;

  // If it doesn't look like a URL (no protocol), assume it's a file path.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalizedCaller)) {
    // Windows path fix (C:\... -> /C:/...)
    normalizedCaller = normalizedCaller.replace(/\\/g, "/");

    // Ensure it starts with a slash if it doesn't already (e.g. C:/...)
    if (!normalizedCaller.startsWith("/")) {
      normalizedCaller = "/" + normalizedCaller;
    }

    // Prepend protocol
    normalizedCaller = "file://" + normalizedCaller;
  }

  // 1. Find all occurrences of "import("
  // We use a regex to find the start, then manually find the end to handle nesting/strings.
  const importStartPattern = /\bimport\s*\(/g;

  const replacements: { start: number; end: number; text: string }[] = [];
  let match: RegExpExecArray | null;

  // 2. Iterate through matches
  while ((match = importStartPattern.exec(code)) !== null) {
    const importStartIndex = match.index;
    // The match[0] contains "import(" or "import (", etc.
    // The argument starts immediately after the opening parenthesis.
    const openParenIndex = importStartIndex + match[0].length - 1;

    // 3. Extract the first argument safely
    const argBounds = findArgumentBounds(code, openParenIndex + 1);

    if (argBounds) {
      const { start, end } = argBounds;
      const originalArgument = code.slice(start, end);

      // 4. Construct replacement
      // We JSON.stringify the NORMALIZED location.
      // If normalizedCaller is "file:///home/...", the `new URL` constructor
      // will accept it as a valid base, or ignore the second arg if the first is absolute.
      const safeCallerLoc = JSON.stringify(normalizedCaller);

      // We use a nested URL constructor structure:
      // 1. Resolve safeCallerLoc against import.meta.url (handles if callerLoc is relative).
      // 2. Resolve originalArgument against the result of 1.
      const newArgument =
        `new URL(${originalArgument}, new URL(${safeCallerLoc}, import.meta.url).href).href`;

      replacements.push({
        start: start,
        end: end,
        text: newArgument,
      });
    }
  }

  // 5. Apply replacements in reverse order (to not mess up indices)
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
