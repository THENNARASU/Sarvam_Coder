const fs = require("fs");
const { ensureWorkspacePath, parseApplyDiff } = require("./helpers");

const runApplyDiff = (workspaceFolder, args) => {
  const buildBlockCandidates = (block) => {
    const rawSearch = String((block && block.search) || "");
    const rawReplace = String((block && block.replace) || "");
    const transforms = [
      {
        search: rawSearch,
        replace: rawReplace
      },
      {
        search: rawSearch.replace(/^\r?\n/, ""),
        replace: rawReplace.replace(/^\r?\n/, "")
      },
      {
        search: rawSearch.replace(/\r?\n$/, ""),
        replace: rawReplace.replace(/\r?\n$/, "")
      },
      {
        search: rawSearch.replace(/^\r?\n/, "").replace(/\r?\n$/, ""),
        replace: rawReplace.replace(/^\r?\n/, "").replace(/\r?\n$/, "")
      }
    ];
    const seen = new Set();
    const candidates = [];
    transforms.forEach((item) => {
      const key = `${item.search}\u0000${item.replace}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(item);
      }
    });
    return candidates;
  };

  const pathValue = (args.path && args.path[0]) || "";
  let diffValue = (args.diff && args.diff[0]) || "";
  if (!diffValue && args.diff) {
    diffValue = args.diff.join("\n");
  }
  if (!diffValue && args.diff && args.diff.length === 0 && args.diff_text) {
    diffValue = args.diff_text.join("\n");
  }
  if (!diffValue && args.args) {
    diffValue = args.args.join("\n");
  }
  if (!diffValue && args.raw) {
    const rawMatch = String(args.raw).match(/<diff>([\s\S]*?)<\/diff>/);
    if (rawMatch) {
      diffValue = rawMatch[1].trim();
    }
  }
  if (!pathValue) {
    return "No path provided.";
  }
  if (!diffValue) {
    return "No diff provided.";
  }
  const filePath = ensureWorkspacePath(workspaceFolder, pathValue);
  const content = fs.readFileSync(filePath, "utf8");
  const blocks = parseApplyDiff(diffValue);
  if (!blocks.length) {
    const preview = String(diffValue || "").replace(/\s+/g, " ").slice(0, 200);
    return `No valid diff blocks found. Expected SEARCH/REPLACE blocks. Preview: ${preview}`;
  }
  let updated = content;
  const hasCrlf = /\r\n/.test(content);
  const normalizeForMatch = (value) => String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "");
  const applyUsingStartLine = (currentText, candidate, startLine) => {
    if (!startLine || !candidate || typeof candidate.search !== "string") {
      return null;
    }
    const normalizedCurrent = String(currentText || "").replace(/\r\n/g, "\n");
    const hasBom = normalizedCurrent.startsWith("\uFEFF");
    const endsWithNewline = /\n$/.test(normalizedCurrent);
    const lines = normalizedCurrent.replace(/^\uFEFF/, "").split("\n");
    const normalizedSearch = normalizeForMatch(candidate.search);
    if (!normalizedSearch) {
      return null;
    }
    const searchLines = normalizedSearch.split("\n");
    const replaceLines = normalizeForMatch(candidate.replace).split("\n");
    const startIndex = Math.max(0, startLine - 1);
    const segment = lines
      .slice(startIndex, startIndex + searchLines.length)
      .map((line) => normalizeForMatch(line))
      .join("\n");
    if (segment !== searchLines.join("\n")) {
      return null;
    }
    lines.splice(startIndex, searchLines.length, ...replaceLines);
    let next = lines.join("\n");
    if (endsWithNewline && !/\n$/.test(next)) {
      next += "\n";
    }
    if (hasBom) {
      next = `\uFEFF${next}`;
    }
    return hasCrlf ? next.replace(/\n/g, "\r\n") : next;
  };
  for (const block of blocks) {
    const candidates = buildBlockCandidates(block);

    if (block.startLine) {
      let lineApplied = false;
      for (const candidate of candidates) {
        const positionalResult = applyUsingStartLine(updated, candidate, block.startLine);
        if (typeof positionalResult === "string") {
          updated = positionalResult;
          lineApplied = true;
          break;
        }
      }
      if (lineApplied) {
        continue;
      }
    }

    const exactCandidate = candidates.find((candidate) => updated.includes(candidate.search));
    if (exactCandidate) {
      updated = updated.replace(exactCandidate.search, exactCandidate.replace);
      continue;
    }

    if (!updated.includes(block.search)) {
      // Fallback for Windows line endings mismatch between model diff text and file content
      const normalizedUpdated = normalizeForMatch(updated);
      let matchedCandidate = null;
      let normalizedSearch = "";
      for (const candidate of candidates) {
        const candidateSearch = normalizeForMatch(candidate.search);
        if (normalizedUpdated.includes(candidateSearch)) {
          matchedCandidate = candidate;
          normalizedSearch = candidateSearch;
          break;
        }
      }
      if (!matchedCandidate) {
        return `Search block not found in ${pathValue}.`;
      }
      const normalizedReplace = normalizeForMatch(matchedCandidate.replace);
      const hasBom = updated.startsWith("\uFEFF");
      const normalizedResult = normalizedUpdated.replace(normalizedSearch, normalizedReplace);
      const withBom = hasBom ? `\uFEFF${normalizedResult}` : normalizedResult;
      updated = hasCrlf ? withBom.replace(/\n/g, "\r\n") : withBom;
      continue;
    }
    updated = updated.replace(block.search, block.replace);
  }
  if (updated === content) {
    return `No changes needed for ${pathValue}.`;
  }
  fs.writeFileSync(filePath, updated, "utf8");
  return `Applied ${blocks.length} diff block(s) to ${pathValue}.`;
};

module.exports = runApplyDiff;
