import * as $ from "./keys.ts";
import { YieldList } from "./types";

async function parseImport(name: string): Promise<string> {
  const resolved = await import.meta.resolve(name);

  if (
    resolved.startsWith("http://") ||
    resolved.startsWith("https://") ||
    resolved.startsWith("npm:") ||
    resolved.startsWith("node:")
  )
    return resolved;

  // Check if running in browser
  const isBrowser = typeof window !== "undefined";

  if (isBrowser) {
    // If running in browser, return the resolved URL
    return resolved;
  }

  const { pathToFileURL } = await import("node:url");

  return pathToFileURL(resolved).toString();
}

export async function parseTopLevelYieldStatements(
  fnStr: string
): Promise<YieldList> {
  const bodyStart = fnStr.indexOf("{") + 1;
  const code = fnStr.slice(bodyStart, -1).trim();
  const lines = code.split(/(?:\s*[;\r\n]+\s*)+/);

  const yieldList: YieldList = [];

  // let insideCommentBlock = false;

  for (const line of lines) {
    // Skip comments
    // if (line.startsWith("/*")) insideCommentBlock = true;
    // if (line.endsWith("*/") || line.startsWith("*/")) {
    //   insideCommentBlock = false;
    //   continue;
    // }
    // if (insideCommentBlock || line.startsWith("//")) continue;

    // If line is not a yield statement, stop parsing
    if (!line.includes("yield ")) continue;

    const yielded = line.split("yield ")[1];

    if (/^["'`]/.test(yielded)) {
      const name = yielded.slice(1, -1);

      yieldList.push({
        [$.Type]: "import",
        [$.Name]: name,
        [$.AbsolutePath]: await parseImport(name),
      });
    } else {
      yieldList.push({
        [$.Type]: "variable",
        [$.Name]: yielded,
      });
    }
  }

  return yieldList;
}
