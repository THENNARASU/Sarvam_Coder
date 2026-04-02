const fs = require("fs");
const path = require("path");
const os = require("os");

const buildSystemPrompt = (extensionPath, workspaceFolder, shell) => {
  const rulesPath = path.join(extensionPath, "prompts", "tool-xml-rules.txt");
  const coderPath = path.join(extensionPath, "prompts", "coder.txt");
  const rulesPrompt = fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, "utf8") : "";
  const rawPrompt = fs.readFileSync(coderPath, "utf8");
  const osDetails = `${os.type()} ${os.release()}`;

  const mergedPrompt = [rulesPrompt, rawPrompt].filter(Boolean).join("\n\n");

  return mergedPrompt
    .split("<operationSystem>")
    .join(osDetails)
    .split("<shell>")
    .join(shell || "")
    .split("<baseDirectory>")
    .join(workspaceFolder);
};

module.exports = {
  buildSystemPrompt
};
