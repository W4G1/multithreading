/**
 * Patches dynamic imports to work in Data URIs / Workers.
 * Universal version: Works in Browser, Deno, and Node.js.
 */
export function patchDynamicImports(
  code: string,
  callerLocation: string,
): string {
  // Normalize callerLocation to be a valid URL (file:// or http://).
  let normalizedCaller = callerLocation;

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalizedCaller)) {
    // Windows fix
    normalizedCaller = normalizedCaller.replace(/\\/g, "/");
    if (!normalizedCaller.startsWith("/")) {
      normalizedCaller = "/" + normalizedCaller;
    }
    normalizedCaller = "file://" + normalizedCaller;
  }

  const importStartPattern = /\bimport\s*\(/g;
  const replacements: { start: number; end: number; text: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = importStartPattern.exec(code)) !== null) {
    const importStartIndex = match.index;
    const openParenIndex = importStartIndex + match[0].length - 1;
    const argBounds = findArgumentBounds(code, openParenIndex + 1);

    if (argBounds) {
      const { start, end } = argBounds;
      const originalArgument = code.slice(start, end);

      const isStringLiteral = /^["'`]/.test(originalArgument);

      // Default assumption: We should apply the fallback patch (new URL wrap)
      // unless we determine it's a package that should be resolved or skipped.
      let shouldApplyFallback = true;

      if (isStringLiteral) {
        const content = originalArgument.slice(1, -1);

        // Check if it is an explicit Path or URL (./, ../, /, http:)
        const isExplicitPath = /^\.{0,2}[/\\]|^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(
          content,
        );

        // Handle packages (Bare Specifiers)
        if (!isExplicitPath) {
          // It is a bare specifier (e.g. "multithreading").
          // We do NOT want to apply the fallback wrapper to these,
          // because new URL("multithreading", ...) creates a broken file path.
          shouldApplyFallback = false;

          try {
            // Try to resolve it to an absolute URL
            const resolvedUrl = import.meta.resolve(content);

            replacements.push({
              start: start,
              end: end,
              text: JSON.stringify(resolvedUrl),
            });
          } catch (e) {
            // Resolution failed (package not found).
            // We do nothing. We leave the code as `import("pkg")`.
            // Crucially, we have set shouldApplyFallback = false,
            // so it won't get mangled below.
          }
        }
      }

      // Handle relative paths and variables (fallback)
      if (shouldApplyFallback) {
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
  }

  // Apply replacements
  replacements.sort((a, b) => b.start - a.start);
  let modifiedCode = code;
  for (const rep of replacements) {
    const before = modifiedCode.slice(0, rep.start);
    const after = modifiedCode.slice(rep.end);
    modifiedCode = before + rep.text + after;
  }

  return modifiedCode;
}

// Helper: Finds the bounds of the import() argument
function findArgumentBounds(code: string, startIndex: number) {
  let index = startIndex;
  const len = code.length;
  let inString: "'" | '"' | "`" | null = null;
  let inComment: "//" | "/*" | null = null;
  let parenDepth = 0;
  let argStart = -1;
  let argEnd = -1;

  for (; index < len; index++) {
    const char = code[index]!;
    const nextChar = code[index + 1];

    // Strings
    if (inString) {
      if (char === "\\" && index + 1 < len) {
        index++;
        argEnd = index + 1;
        continue;
      }
      if (char === inString) inString = null;
      if (argStart === -1) argStart = index;
      argEnd = index + 1;
      continue;
    }

    // Comments
    if (inComment) {
      if (inComment === "//" && char === "\n") inComment = null;
      else if (inComment === "/*" && char === "*" && nextChar === "/") {
        inComment = null;
        index++;
      }
      continue;
    }

    // Start Strings
    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      if (argStart === -1) argStart = index;
      argEnd = index + 1;
      continue;
    }

    // Start Comments
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

    // Syntax
    if (char === "(") {
      parenDepth++;
      if (argStart === -1) argStart = index;
      argEnd = index + 1;
    } else if (char === ")") {
      if (parenDepth === 0) {
        if (argStart === -1) return null;
        return { start: argStart, end: argEnd };
      }
      parenDepth--;
      if (argStart === -1) argStart = index;
      argEnd = index + 1;
    } else if (char === ",") {
      if (parenDepth === 0) {
        if (argStart === -1) return null;
        return { start: argStart, end: argEnd };
      }
      if (argStart === -1) argStart = index;
      argEnd = index + 1;
    } else {
      if (!/\s/.test(char)) {
        if (argStart === -1) argStart = index;
        argEnd = index + 1;
      }
    }
  }
  return null;
}
