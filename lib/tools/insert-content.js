const fs = require("fs");
const { ensureWorkspacePath, normalizeRelPath } = require("./helpers");

const runInsertContent = (workspaceFolder, args) => {
  const pathValue = normalizeRelPath((args.path && args.path[0]) || "");
  const contentValue = (args.content && args.content[0]) || "";
  const lineValue = args.line && args.line[0] ? Number(args.line[0]) : null;
  if (!pathValue) {
    return "No path provided.";
  }
  if (lineValue === null || Number.isNaN(lineValue)) {
    return "No line provided.";
  }

  const filePath = ensureWorkspacePath(workspaceFolder, pathValue);
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  const insertIndex = lineValue <= 0 ? lines.length : Math.max(0, lineValue - 1);
  const insertLines = String(contentValue).split(/\r?\n/);
  lines.splice(insertIndex, 0, ...insertLines);
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
  return `Inserted content into ${pathValue}.`;
};

module.exports = runInsertContent;
