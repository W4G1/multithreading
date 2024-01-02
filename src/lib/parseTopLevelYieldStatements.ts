import { pathToFileURL } from "node:url";
import * as $ from "./keys.ts";
import { YieldList } from "./types";

function parseImport(name: string): string {
  const resolved = import.meta.resolve(name);

  if (
    resolved.startsWith("http://") ||
    resolved.startsWith("https://") ||
    resolved.startsWith("npm:") ||
    resolved.startsWith("node:")
  )
    return resolved;

  return pathToFileURL(resolved).toString();
}

export function parseTopLevelYieldStatements(fnStr: string): YieldList {
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
        [$.AbsolutePath]: parseImport(name),
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
