const { spawn } = require("child_process");
const path = require("path");
const { pathToFileURL } = require("url");

function runDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    ...options
  });
  child.unref();
  return child;
}

function buildCommandCandidates() {
  if (process.platform === "win32") {
    return ["code.cmd", "code"]; 
  }
  return ["code"];
}

function quoteArg(value) {
  if (!value) {
    return "";
  }
  if (/\s/.test(value)) {
    return `"${value.replace(/"/g, "\\\"")}"`;
  }
  return value;
}

function launchExtensionHost(args) {
  const candidates = buildCommandCandidates();
  let launched = false;
  for (const command of candidates) {
    try {
      const child = runDetached(command, args);
      child.on("error", () => {});
      launched = true;
      break;
    } catch (error) {
      launched = false;
    }
  }

  if (!launched) {
    const commandLine = ["code", ...args.map(quoteArg)].join(" ");
    runDetached(commandLine, [], { shell: true });
  }
}

console.log("Opening VS Code Extension Development Host...");
const root = path.resolve(process.cwd());
const folderUri = pathToFileURL(root).toString();
launchExtensionHost([
  "-n",
  `--extensionDevelopmentPath=${root}`,
  `--folder-uri=${folderUri}`
]);
