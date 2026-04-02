const fs = require("fs");
const path = require("path");
const { ensureWorkspacePath, normalizeRelPath } = require("./helpers");

const runListFiles = (workspaceFolder, args) => {
  const targetPath = normalizeRelPath((args.path && args.path[0]) || ".") || ".";
  const recursive = (args.recursive && args.recursive[0]) === "true";
  const basePath = ensureWorkspacePath(workspaceFolder, targetPath);
  const entries = [];

  const walk = (currentPath) => {
    const items = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const item of items) {
      if (item.name === ".sarvam") {
        continue;
      }
      const fullPath = path.join(currentPath, item.name);
      const relPath = path.relative(workspaceFolder, fullPath) + (item.isDirectory() ? path.sep : "");
      entries.push(relPath);
      if (recursive && item.isDirectory()) {
        walk(fullPath);
      }
    }
  };

  walk(basePath);
  return entries.join("\n");
};

module.exports = runListFiles;
