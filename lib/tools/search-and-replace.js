const fs = require("fs");
const { ensureWorkspacePath, normalizeRelPath } = require("./helpers");

const runSearchAndReplace = (workspaceFolder, args) => {
  const pathValue = normalizeRelPath((args.path && args.path[0]) || "");
  const searchValue = (args.search && args.search[0]) || "";
  const replaceValue = (args.replace && args.replace[0]) || "";
  const useRegex = (args.use_regex && args.use_regex[0]) === "true";
  const ignoreCase = (args.ignore_case && args.ignore_case[0]) === "true";
  const startLine = args.start_line ? Number(args.start_line[0]) : null;
  const endLine = args.end_line ? Number(args.end_line[0]) : null;

  if (!pathValue) {
    return "No path provided.";
  }
  if (!searchValue) {
    return "No search provided.";
  }

  const filePath = ensureWorkspacePath(workspaceFolder, pathValue);
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const startIndex = startLine && startLine > 0 ? Math.max(0, startLine - 1) : 0;
  const endIndex = endLine && endLine > 0 ? Math.min(lines.length - 1, endLine - 1) : lines.length - 1;
  const targetLines = lines.slice(startIndex, endIndex + 1).join("\n");

  let updatedSegment = targetLines;
  if (useRegex) {
    const flags = ignoreCase ? "gi" : "g";
    const regex = new RegExp(searchValue, flags);
    updatedSegment = updatedSegment.replace(regex, replaceValue);
  } else if (ignoreCase) {
    const regex = new RegExp(searchValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    updatedSegment = updatedSegment.replace(regex, replaceValue);
  } else {
    updatedSegment = updatedSegment.split(searchValue).join(replaceValue);
  }

  const updatedLines = [
    ...lines.slice(0, startIndex),
    ...updatedSegment.split("\n"),
    ...lines.slice(endIndex + 1)
  ];
  fs.writeFileSync(filePath, updatedLines.join("\n"), "utf8");
  return `Updated ${pathValue}.`;
};

module.exports = runSearchAndReplace;
