// ── Minimal line-based diff (Myers-like LCS approach) ───────────────────────

/**
 * Compute a line-level diff between two strings.
 * Returns an array of { type, value } where type is "equal", "add", or "remove".
 */
export function computeDiff(original, modified) {
  const oldLines = original.split("\n");
  const newLines = modified.split("\n");

  // LCS via DP
  const m = oldLines.length;
  const n = newLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: "equal", value: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "add", value: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: "remove", value: oldLines[i - 1] });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Extract the first fenced code block from a markdown string.
 * Returns { lang, code } or null.
 */
export function extractCodeBlock(text) {
  const match = text.match(/```(\w*)\s*\n([\s\S]*?)```/);
  if (!match) return null;
  return { lang: match[1] || "", code: match[2].replace(/\n$/, "") };
}

/**
 * Extract ALL fenced code blocks from a markdown string.
 * Returns [{ lang, code }].
 */
export function extractAllCodeBlocks(text) {
  const regex = /```(\w*)\s*\n([\s\S]*?)```/g;
  const blocks = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    blocks.push({ lang: m[1] || "", code: m[2].replace(/\n$/, "") });
  }
  return blocks;
}
