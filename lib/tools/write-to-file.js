const fs = require("fs");
const path = require("path");
const { ensureWorkspacePath, normalizeRelPath } = require("./helpers");

const runWriteFile = (workspaceFolder, args) => {
  const pathValue = normalizeRelPath((args.path && args.path[0]) || "");
  const contentValue = (args.content && args.content[0]) || "";
  if (!pathValue) {
    return "No path provided.";
  }
  const filePath = ensureWorkspacePath(workspaceFolder, pathValue);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contentValue, "utf8");
  return `Wrote ${pathValue}.`;
};

module.exports = runWriteFile;
