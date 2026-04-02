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
  const blocks = [];
  const pattern = /<<<<<<<\s*SEARCH[\s\S]*?-------([\s\S]*?)=======([\s\S]*?)>>>>>>>\s*REPLACE/g;
  let match;
  while ((match = pattern.exec(diffText))) {
    const search = match[1];
    const replace = match[2];
    blocks.push({ search, replace });
  }
  return blocks;
};

module.exports = {
  ensureWorkspacePath,
  normalizeRelPath,
  decodeXmlEntities,
  parseApplyDiff
};
