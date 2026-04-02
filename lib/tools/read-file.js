const fs = require("fs");
const { ensureWorkspacePath, normalizeRelPath } = require("./helpers");

const runReadFile = (workspaceFolder, args) => {
  const paths = (args.path || []).map(normalizeRelPath).filter(Boolean);
  if (!paths.length) {
    return "No path provided.";
  }

  const outputs = paths.slice(0, 5).map((relPath) => {
    const filePath = ensureWorkspacePath(workspaceFolder, relPath);
    const content = fs.readFileSync(filePath, "utf8");
    return `# ${relPath}\n${content}`;
  });

  return outputs.join("\n\n");
};

module.exports = runReadFile;
