const fs = require("fs");
const { ensureWorkspacePath, parseApplyDiff } = require("./helpers");

const runApplyDiff = (workspaceFolder, args) => {
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
    return "No valid diff blocks found.";
  }
  let updated = content;
  for (const block of blocks) {
    if (!updated.includes(block.search)) {
      return `Search block not found in ${pathValue}.`;
    }
    updated = updated.replace(block.search, block.replace);
  }
  fs.writeFileSync(filePath, updated, "utf8");
  return `Applied ${blocks.length} diff block(s) to ${pathValue}.`;
};

module.exports = runApplyDiff;
