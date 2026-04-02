const fs = require("fs");
const path = require("path");
const { ensureWorkspacePath, normalizeRelPath } = require("./helpers");

const patterns = [
  /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  /\binterface\s+([A-Za-z_][A-Za-z0-9_]*)/g,
  /\btype\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g,
  /\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
  /\bdef\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
  /\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/g,
  /\blet\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/g,
  /\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/g
];

const extractNames = (content) => {
  const names = new Set();
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(content))) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  });
  return Array.from(names);
};

const runListCodeDefinitionNames = (workspaceFolder, args) => {
  const targetPath = normalizeRelPath((args.path && args.path[0]) || "");
  if (!targetPath) {
    return "No path provided.";
  }
  const absolutePath = ensureWorkspacePath(workspaceFolder, targetPath);
  const stat = fs.statSync(absolutePath);
  const files = [];
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(absolutePath, { withFileTypes: true });
    entries.forEach((entry) => {
      if (entry.isFile()) {
        files.push(path.join(absolutePath, entry.name));
      }
    });
  } else {
    files.push(absolutePath);
  }

  if (!files.length) {
    return "No files found.";
  }

  const outputs = files.map((filePath) => {
    const content = fs.readFileSync(filePath, "utf8");
    const names = extractNames(content);
    const relPath = path.relative(workspaceFolder, filePath);
    if (!names.length) {
      return `# ${relPath}\n(no definitions found)`;
    }
    return `# ${relPath}\n${names.join("\n")}`;
  });

  return outputs.join("\n\n");
};

module.exports = runListCodeDefinitionNames;
