const fs = require("fs");
const path = require("path");

const writeInitialCheckpoint = (workspaceFolder, payload) => {
  const root = path.join(workspaceFolder, ".sarvam", "checkpoints");
  fs.mkdirSync(root, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}-initial.json`;
  const filePath = path.join(root, fileName);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
};

module.exports = {
  writeInitialCheckpoint
};
