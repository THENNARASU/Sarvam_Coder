const fs = require("fs");
const path = require("path");
const { ensureWorkspacePath, normalizeRelPath } = require("./helpers");

const runSearchFiles = (workspaceFolder, args) => {
  const targetPath = normalizeRelPath((args.path && args.path[0]) || ".") || ".";
  const regexValue = (args.regex && args.regex[0]) || "";
  const filePattern = (args.file_pattern && args.file_pattern[0]) || "";
  if (!regexValue) {
    return "No regex provided.";
  }

  const basePath = ensureWorkspacePath(workspaceFolder, targetPath);
  const regex = new RegExp(regexValue, "i");
  const matches = [];

  const walk = (currentPath) => {
    const items = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);
      if (item.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (filePattern && !fullPath.endsWith(filePattern.replace("*", ""))) {
        continue;
      }

      const content = fs.readFileSync(fullPath, "utf8");
      if (regex.test(content)) {
        matches.push(path.relative(workspaceFolder, fullPath));
      }
    }
  };

  walk(basePath);
  return matches.length ? matches.join("\n") : "No matches.";
};

module.exports = runSearchFiles;
