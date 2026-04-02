const path = require("path");

const ensureWorkspacePath = (workspaceFolder, targetPath) => {
  const resolved = path.resolve(workspaceFolder, targetPath);
  if (!resolved.startsWith(path.resolve(workspaceFolder))) {
    throw new Error("Path is outside workspace.");
  }
  return resolved;
};

const normalizeRelPath = (value) => {
  if (!value) {
    return "";
  }
  return String(value).replace(/^[\\/]+/, "");
};

const decodeXmlEntities = (value) => {
  if (!value) {
    return "";
  }
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
};

const parseApplyDiff = (diffText) => {
  if (!diffText) {
    return [];
  }
  const normalizedText = decodeXmlEntities(String(diffText || "")).replace(/\r\n?/g, "\n");
  const fencedMatch = normalizedText.match(/```(?:diff|text)?\s*([\s\S]*?)```/i);
  const source = fencedMatch && fencedMatch[1] ? fencedMatch[1] : normalizedText;
  const blocks = [];
  const addBlocks = (pattern, mapper) => {
    let match;
    while ((match = pattern.exec(source))) {
      const block = mapper(match);
      if (block) {
        blocks.push(block);
      }
    }
  };

  // Preferred format documented in prompts/coder.txt:
  // <<<<<<< SEARCH
  // :start_line:4
  // -------
  // old text
  // =======
  // new text
  // >>>>>>> REPLACE
  addBlocks(
    /^[ \t]*<<<<<<<\s*SEARCH([\s\S]*?)^[ \t]*-------\s*\n?([\s\S]*?)^[ \t]*=======\s*\n?([\s\S]*?)^[ \t]*>>>>>>>\s*REPLACE\s*$/gim,
    (match) => {
      const metadata = String(match[1] || "");
      const search = match[2];
      const replace = match[3];
      const startLineMatch = metadata.match(/:start_line:\s*(\d+)/i) || metadata.match(/^\s*:(\d+)\s*$/m);
      const startLine = startLineMatch ? Number(startLineMatch[1]) : null;
      return {
        search,
        replace,
        startLine: Number.isFinite(startLine) && startLine > 0 ? startLine : null
      };
    }
  );

  // Legacy/simple format that some models still emit:
  // <<<<<<< SEARCH
  // old text
  // =======
  // new text
  // >>>>>>> REPLACE
  if (!blocks.length) {
    addBlocks(
      /^[ \t]*<<<<<<<\s*SEARCH\s*\n?([\s\S]*?)^[ \t]*=======\s*\n?([\s\S]*?)^[ \t]*>>>>>>>\s*REPLACE\s*$/gim,
      (match) => ({
        search: match[1],
        replace: match[2],
        startLine: null
      })
    );
  }
  return blocks;
};

module.exports = {
  ensureWorkspacePath,
  normalizeRelPath,
  decodeXmlEntities,
  parseApplyDiff
};
