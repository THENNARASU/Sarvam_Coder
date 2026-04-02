const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const root = process.cwd();
const port = Number(process.env.PORT || 3030);
const openCodeWindow = !process.argv.includes("--no-code");
const openBrowser = !process.argv.includes("--no-browser");

function runDetached(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

function waitForServer(url, timeoutMs) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    function check() {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });

      req.on("error", retry);

      function retry() {
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Server did not become ready within ${timeoutMs}ms`));
          return;
        }
        setTimeout(check, 600);
      }
    }

    check();
  });
}

async function main() {
  console.log("Starting Sarvam verification workflow...");

  if (openCodeWindow) {
    // Open a fresh VS Code window for this workspace.
    runDetached("cmd.exe", ["/d", "/s", "/c", "start", "", "code", "-n", "."]);
    console.log("Opened new VS Code window.");
  }

  const server = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    stdio: "inherit"
  });

  const url = `http://localhost:${port}`;
  try {
    await waitForServer(`${url}/api/policy`, 30000);
    console.log(`Server is reachable at ${url}`);

    if (openBrowser) {
      runDetached("cmd.exe", ["/d", "/s", "/c", "start", "", url]);
      console.log("Opened browser.");
    }

    console.log("Use Settings page to enter Base URL, API Key, and Model for SarvamAPI-compatible endpoint verification.");
  } catch (error) {
    console.error(String(error.message || error));
    server.kill("SIGTERM");
    process.exitCode = 1;
    return;
  }

  function shutdown() {
    if (!server.killed) {
      server.kill("SIGTERM");
    }
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(String(error.message || error));
  process.exit(1);
});
