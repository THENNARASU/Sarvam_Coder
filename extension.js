const vscode = require("vscode");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { buildSystemPrompt } = require("./lib/prompt");
const { streamChatCompletions } = require("./lib/openai");
const { extractToolCall, runTool } = require("./lib/tools");
const { writeInitialCheckpoint } = require("./lib/checkpoints");
const { exec } = require("child_process");

function registerDevAutoReload(context) {
  if (context.extensionMode !== vscode.ExtensionMode.Development) {
    return;
  }

  let reloadTimer;
  const scheduleReload = () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }
    reloadTimer = setTimeout(() => {
      void vscode.commands.executeCommand("workbench.action.reloadWindow");
    }, 300);
  };

  const watchers = [
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(context.extensionPath, "media/**/*")),
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(context.extensionPath, "extension.js")),
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(context.extensionPath, "package.json"))
  ];

  watchers.forEach((watcher) => {
    watcher.onDidChange(scheduleReload);
    watcher.onDidCreate(scheduleReload);
    watcher.onDidDelete(scheduleReload);
    context.subscriptions.push(watcher);
  });
}

function buildWebviewHtml(webview, extensionUri, initialState) {
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.css"));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.js"));
  const nonce = crypto.randomBytes(16).toString("hex");
  const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "sarvam.png"));
  const safeState = JSON.stringify(initialState);
  const defaults = initialState.defaults || {};
  const settings = initialState.settings || defaults;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <link rel="stylesheet" href="${cssUri}" />
  <title>Sarvam Coder</title>
</head>
<body>
  <div class="shell" data-first-run="${initialState.firstRun ? "true" : "false"}" data-has-conversation="${initialState.hasConversation ? "true" : "false"}" data-sarvam-icon="${iconUri}" style="--sarvam-icon: url('${iconUri}')">
    <header class="topbar">
      <span class="brand">Sarvam Coder</span>
      <div class="topbar-actions">
        <button class="task-add" type="button" aria-label="Add task">Add Task</button>
        <button class="task-history" type="button" aria-label="Task history">Task History</button>
          <button class="settings-toggle" type="button" aria-label="Open settings">Settings</button>
      </div>
    </header>
    <section class="history-view" aria-label="Task history" aria-hidden="true">
        <div class="history-header">
        <div class="history-title">History</div>
        <div class="history-actions">
          <button class="history-done" type="button">Done</button>
        </div>
      </div>
      <div class="history-search">
        <input class="history-search-input" type="search" placeholder="Search history..." />
      </div>
      <div class="history-list"></div>
    </section>
    <aside class="settings-panel" aria-label="Settings" aria-hidden="true">
      <div class="settings-actions">
        <button class="settings-reset" type="button">Reset</button>
        <button class="settings-save" type="button">Save</button>
        <button class="settings-done" type="button">Done</button>
      </div>
      <form class="settings" autocomplete="off">
        <label>
          Base URL
          <input name="baseUrl" type="text" placeholder="Enter base URL..." value="${settings.baseUrl || ""}" />
        </label>
        <label>
          API Key
          <input name="apiKey" type="password" placeholder="Enter API key..." value="${settings.apiKey || ""}" />
        </label>
        <label>
          Model
          <input name="model" type="text" placeholder="Enter model ID..." value="${settings.model || ""}" />
        </label>
        <label>
          Context Window Size
          <input name="contextWindow" type="number" min="1024" step="1" value="${settings.contextWindow || ""}" />
        </label>
        <p class="hint">Total tokens (input + output) the model can process.</p>
        <p class="error" data-error="settings" hidden>All fields are required.</p>
      </form>
    </aside>
    <div class="page">
    <section class="welcome" aria-label="Welcome">
      <img class="brand-icon" src="${iconUri}" alt="Sarvam" />
      <h1>Welcome to Sarvam Coder!</h1>
      <p>Generate, refactor, and debug code with AI assistance.</p>
      <p class="muted">To do its magic, Sarvam Coder needs an API key.</p>
      <form class="settings" autocomplete="off">
        <label>
          Base URL
          <input name="baseUrl" type="text" placeholder="Enter base URL..." value="${settings.baseUrl || ""}" />
        </label>
        <label>
          API Key
          <input name="apiKey" type="password" placeholder="Enter API key..." value="${settings.apiKey || ""}" />
        </label>
        <label>
          Model
          <input name="model" type="text" placeholder="Enter model ID..." value="${settings.model || ""}" />
        </label>
        <label>
          Context Window Size
          <input name="contextWindow" type="number" min="1024" step="1" value="${settings.contextWindow || ""}" />
        </label>
        <p class="hint">Total tokens (input + output) the model can process.</p>
        <p class="error" data-error="welcome" hidden>All fields are required.</p>
        <button type="submit">Let's go!</button>
      </form>
    </section>
    <section class="ready" aria-label="Ready">
      <div class="task-panel">
        <div class="task-header">
          <div class="task-title">Current Task</div>
          <div class="task-meta">
            <div class="context-row">
              <span>Context Length:</span>
              <span class="context-value" data-context-length>0</span>
              <div class="context-bar" aria-hidden="true">
                <div class="context-bar__fill" data-context-fill></div>
              </div>
              <span class="context-max" data-context-max>${settings.contextWindow || ""}</span>
            </div>
            <div class="token-row">
              Tokens:
              <span class="token-in" data-tokens-in>0</span>
              <span aria-hidden="true">\u2193</span>
              <span class="token-out" data-tokens-out>0</span>
            </div>
          </div>
        </div>
      </div>
      <div class="conversation" aria-live="polite"></div>
      <div class="tool-approval" hidden>
        <div class="tool-approval__title">Tool Request</div>
        <pre class="tool-approval__body"></pre>
        <div class="tool-approval__actions">
          <button class="tool-approve" type="button">Approve</button>
          <button class="tool-reject" type="button">Reject</button>
        </div>
      </div>
      <div class="followup-panel" hidden>
        <div class="followup-title">Follow-up</div>
        <div class="followup-question"></div>
        <div class="followup-choices"></div>
        <div class="followup-custom">
          <label>
            Custom answer
            <input class="followup-input" type="text" placeholder="Type your answer..." />
          </label>
          <div class="followup-actions">
            <button class="followup-send" type="button">Send</button>
            <button class="followup-skip" type="button">Skip</button>
          </div>
        </div>
      </div>
      <div class="ready-input" aria-label="Task input">
        <textarea rows="3" placeholder="Type your coding tasks here"></textarea>
        <button class="send-button" type="button">Send</button>
      </div>
      <div class="auto-approve">Auto-approve: <span data-auto-approve>None</span></div>
    </section>
    <aside class="eventlog-view" aria-label="Event log" aria-hidden="true">
      <div class="eventlog-header">
        <div class="eventlog-title">Background Log</div>
        <button class="eventlog-close" type="button">Done</button>
      </div>
      <div class="eventlog-list"></div>
    </aside>
    </div>
  </div>
  <script nonce="${nonce}">window.__SARVAM_STATE__ = ${safeState};</script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showSystemPromptPanel(context, prompt) {
  const panel = vscode.window.createWebviewPanel(
    "sarvamCoder.systemPrompt",
    "Sarvam: System Prompt",
    vscode.ViewColumn.Active,
    { enableScripts: false }
  );

  panel.webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Sarvam System Prompt</title>
  <style>
    body {
      margin: 16px;
      font-family: "Segoe UI", sans-serif;
      color: #1c1b1a;
      background: #ffffff;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "Consolas", "Courier New", monospace;
      font-size: 12px;
      background: #f5f4f1;
      border: 1px solid #d7d3cd;
      border-radius: 8px;
      padding: 12px;
    }
  </style>
</head>
<body>
  <pre>${escapeHtml(prompt)}</pre>
</body>
</html>`;
}

function approximateTokens(text) {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

function getWorkspaceFolder() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
}

function getSarvamRoot(workspaceFolder) {
  return path.join(workspaceFolder, ".sarvam");
}

function getSarvamStatePath(workspaceFolder) {
  return path.join(getSarvamRoot(workspaceFolder), "state.json");
}

function loadSarvamState(workspaceFolder) {
  const statePath = getSarvamStatePath(workspaceFolder);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function saveSarvamState(workspaceFolder, state) {
  const root = getSarvamRoot(workspaceFolder);
  const statePath = getSarvamStatePath(workspaceFolder);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function getAutoApproveConfig() {
  return {
    read: false,
    write: false,
    execute: false,
    other: true
  };
}

function createHistoryEntry(role, displayText, rawText, modelText) {
  let displayValue = displayText || "";
  const rawValue = rawText || "";
  if (!displayValue && rawValue && role !== "assistant") {
    const stripped = stripToolXml(rawValue);
    displayValue = stripped || "(tool call)";
  }
  return {
    role,
    content: displayValue,
    display: displayValue,
    raw: rawValue,
    model: modelText || displayValue || ""
  };
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return createHistoryEntry("assistant", String(entry || ""), String(entry || ""), String(entry || ""));
  }
  let displayText = entry.display || entry.content || "";
  const rawText = entry.raw || entry.content || "";
  if (rawText) {
    const stripped = stripToolXml(rawText);
    if ((entry.role !== "assistant") && (!displayText || /<\/?[a-z][\s\S]*?>/i.test(displayText))) {
      displayText = stripped || displayText || "(tool call)";
    }
  }
  if (!displayText && entry.role !== "assistant") {
    displayText = "(no content)";
  }
  const modelText = entry.model || entry.content || displayText || "";
  return {
    ...entry,
    content: displayText,
    display: displayText,
    raw: rawText,
    model: modelText
  };
}

function buildModelMessages(systemPrompt, history) {
  const normalized = Array.isArray(history) ? history.map(normalizeHistoryEntry) : [];
  const toolTagRegex = /<\/?[a-z][\s\S]*?>/i;
  const roleMap = {
    "tool-execution": "user",
    "tool_execution": "user",
    "toolresult": "user",
    "tool-result": "user",
    error: "assistant",
    forward: "assistant"
  };
  const allowedRoles = new Set(["system", "user", "assistant", "tool"]);
  const messages = normalized
    .filter((entry) => {
      const raw = entry.raw || "";
      const content = entry.model || entry.content || "";
      if (entry.role === "assistant" && (!content || content === "(tool call)") && toolTagRegex.test(raw)) {
        return false;
      }
      return true;
    })
    .map((entry) => {
    const rawRole = entry.role || "assistant";
    const mappedRole = roleMap[rawRole] || rawRole;
    let role = allowedRoles.has(mappedRole) ? mappedRole : "assistant";
    if (role === "tool" && !entry.toolCallId) {
      role = "assistant";
    }
    return {
      role,
      content: entry.model || entry.content || ""
    };
  });
  return [{ role: "system", content: systemPrompt }, ...messages];
}

function buildDisplayHistory(history) {
  return (history || []).map((entry) => {
    const normalized = normalizeHistoryEntry(entry);
    let displayText = normalized.display || "";
    if (!displayText && normalized.raw && normalized.role !== "assistant") {
      const stripped = stripToolXml(normalized.raw);
      displayText = stripped || "(tool call)";
    }
    return {
      role: normalized.role,
      content: displayText,
      raw: normalized.raw || ""
    };
  });
}

function createCheckpoint(workspaceFolder, payload, label) {
  const root = path.join(workspaceFolder, ".sarvam", "checkpoints");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}-${label}.json`;
  const filePath = path.join(root, fileName);
  const fs = require("fs");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

function stripToolXml(text) {
  if (!text) {
    return "";
  }
  let cleaned = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, " ")
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, " ")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, " ")
    .replace(/<tool>[\s\S]*?<\/tool>/gi, " ")
    .replace(/<attempt_completion>[\s\S]*?<\/attempt_completion>/gi, " ")
    .replace(/<result>[\s\S]*?<\/result>/gi, " ")
    .replace(/<ask_followup_question>[\s\S]*?<\/ask_followup_question>/gi, " ")
    .replace(/<question>[\s\S]*?<\/question>/gi, " ")
    .replace(/<follow_up>[\s\S]*?<\/follow_up>/gi, " ")
    .replace(/<suggest>[\s\S]*?<\/suggest>/gi, " ")
    .replace(/<title_name>[\s\S]*?<\/title_name>/gi, " ")
    .replace(/<list_files>[\s\S]*?<\/list_files>/gi, " ")
    .replace(/<search_files>[\s\S]*?<\/search_files>/gi, " ")
    .replace(/<read_file>[\s\S]*?<\/read_file>/gi, " ")
    .replace(/<write_to_file>[\s\S]*?<\/write_to_file>/gi, " ")
    .replace(/<execute_command>[\s\S]*?<\/execute_command>/gi, " ")
    .replace(/<name>[\s\S]*?<\/name>/gi, " ")
    .replace(/<(arguments|args|arg_key|arg_value)>[\s\S]*?<\/(arguments|args|arg_key|arg_value)>/gi, " ");
  const toolIndex = cleaned.search(/<(tool_call|tool|name|arguments|args|arg_key|arg_value)\b/i);
  if (toolIndex >= 0) {
    cleaned = cleaned.slice(0, toolIndex);
  }
  return cleaned
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(value, maxLength) {
  if (!value) {
    return "";
  }
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}...`;
}

function ensureWorkspacePath(workspaceFolder, targetPath) {
  const resolved = path.resolve(workspaceFolder, targetPath);
  if (!resolved.startsWith(path.resolve(workspaceFolder))) {
    throw new Error("Path is outside workspace.");
  }
  return resolved;
}

function summarizeToolArgs(args) {
  if (!args || typeof args !== "object") {
    return "";
  }
  const keys = Object.keys(args)
    .filter((key) => !["tool_call", "arg_key", "arg_value"].includes(key))
    .slice(0, 4);
  if (!keys.length) {
    return "";
  }
  const parts = keys.map((key) => {
    const value = Array.isArray(args[key]) ? args[key][0] : args[key];
    return `${key}: ${truncateText(value, 120)}`;
  });
  return parts.join(" | ");
}

function summarizeToolRequest(toolCall) {
  const name = toolCall.name || "tool";
  const args = toolCall.args || {};
  const firstArg = (key) => (args[key] && args[key][0] ? String(args[key][0]) : "");
  if (name === "read_file") {
    const paths = (args.path || []).map((value) => String(value).trim()).filter(Boolean);
    return {
      title: "Read file",
      detail: paths.length ? paths.join(", ") : "(no path)"
    };
  }
  if (name === "write_to_file") {
    return {
      title: "Write file",
      detail: firstArg("path") || "(no path)"
    };
  }
  if (name === "apply_diff") {
    return {
      title: "Edit file (apply diff)",
      detail: firstArg("path") || "(no path)"
    };
  }
  if (name === "search_and_replace") {
    return {
      title: "Edit file (search/replace)",
      detail: firstArg("path") || "(no path)"
    };
  }
  if (name === "insert_content") {
    const pathValue = firstArg("path") || "(no path)";
    const lineValue = firstArg("line") ? `line ${firstArg("line")}` : "";
    return {
      title: "Edit file (insert content)",
      detail: [pathValue, lineValue].filter(Boolean).join(" | ")
    };
  }
  if (name === "execute_command") {
    return {
      title: "Run command",
      detail: firstArg("command") || "(no command)"
    };
  }
  if (name === "update_todo_list") {
    return { title: "Update todo list", detail: "" };
  }
  return { title: name, detail: summarizeToolArgs(args) };
}

function formatToolResultSummary(toolCall, meta = {}) {
  const name = toolCall.name || "tool";
  const args = toolCall.args || {};
  const firstArg = (key) => (args[key] && args[key][0] ? String(args[key][0]).trim() : "");
  const listArg = (key) => (Array.isArray(args[key]) ? args[key] : []).map((value) => String(value).trim()).filter(Boolean);
  const pathList = listArg("path");
  const pathValue = pathList.length ? pathList.join(", ") : firstArg("path");
  const commandValue = firstArg("command");
  const detailSuffix = pathValue && pathValue !== "." ? ` ${pathValue}` : "";

  if (name === "read_file") {
    return `Reading file${pathValue ? ` ${pathValue}` : ""}`;
  }
  if (name === "write_to_file") {
    const action = meta.preWriteExists ? "Updating file" : "Creating file";
    return `${action}${pathValue ? ` ${pathValue}` : ""}`;
  }
  if (name === "apply_diff" || name === "search_and_replace" || name === "insert_content") {
    return `Updating file${pathValue ? ` ${pathValue}` : ""}`;
  }
  if (name === "list_files") {
    return `Listing files${detailSuffix}`;
  }
  if (name === "search_files") {
    return `Searching files${detailSuffix}`;
  }
  if (name === "list_code_definition_names") {
    return `Listing code definitions${detailSuffix}`;
  }
  if (name === "execute_command") {
    return `Running command${commandValue ? ` ${commandValue}` : ""}`;
  }
  if (name === "update_todo_list") {
    return "Updating todo list";
  }
  return name;
}

function summarizeMessages(messages, limit) {
  const maxItems = typeof limit === "number" ? limit : 10;
  const slice = messages.length > maxItems ? messages.slice(-maxItems) : messages;
  return slice.map((msg) => ({
    role: msg.role,
    name: msg.name,
    preview: truncateText(msg.content || "", 200)
  }));
}

function parseFollowupOptions(toolCall) {
  const args = toolCall.args || {};
  const question = (args.question && args.question[0]) || "";
  let options = [];
  if (args.suggest && args.suggest.length) {
    options = args.suggest.map((value) => String(value).trim()).filter(Boolean);
  }
  if (!options.length && toolCall.raw) {
    const matches = String(toolCall.raw).match(/<suggest>([\s\S]*?)<\/suggest>/g) || [];
    options = matches
      .map((item) => item.replace(/<\/?suggest>/g, "").trim())
      .filter(Boolean);
  }
  if (!options.length) {
    options = ["Continue"];
  }
  return { question: String(question).trim(), options };
}

function formatFollowupDisplay(followup) {
  if (!followup) {
    return "Follow-up question";
  }
  const question = followup.question ? String(followup.question).trim() : "";
  const options = Array.isArray(followup.options) ? followup.options.filter(Boolean) : [];
  const lines = ["Follow-up question"];
  if (question) {
    lines.push(`Q: ${question}`);
  }
  if (options.length) {
    lines.push("Options:");
    options.forEach((option) => {
      lines.push(`- ${option}`);
    });
  }
  return lines.join("\n");
}

function escapeToolResultForModel(result) {
  if (!result) {
    return "";
  }
  return String(result)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function extractAttemptCompletion(text) {
  if (!text) {
    return "";
  }
  const match = String(text).match(/<attempt_completion>[\s\S]*?<result>([\s\S]*?)<\/result>[\s\S]*?<\/attempt_completion>/i);
  if (!match) {
    return "";
  }
  return String(match[1]).trim();
}

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return "";
  }
}

function normalizeShellCommand(command, shellPath) {
  if (!command) {
    return "";
  }
  const shellName = String(shellPath || "").toLowerCase();
  const isPowerShell = shellName.includes("powershell") || shellName.includes("pwsh");
  let normalized = String(command);
  if (isPowerShell) {
    // Replace '&&' with ';' for PowerShell compatibility
    normalized = normalized.replace(/\s*&&\s*/g, "; ");
    // Use 'where.exe' for 'where' in PowerShell
    normalized = normalized.replace(/\bwhere\s+/gi, "where.exe ");
    // Use 'Get-Command' for 'which' in PowerShell
    normalized = normalized.replace(/\bwhich\s+/gi, "Get-Command ");
  }
  return normalized;
}

function buildShellInvocation(shellPath, command) {
  const shellName = String(shellPath || "").toLowerCase();
  if (shellName.includes("powershell") || shellName.includes("pwsh")) {
    return { file: shellPath, args: ["-NoLogo", "-NoProfile", "-Command", command] };
  }
  if (shellName.includes("cmd.exe") || shellName.endsWith("cmd")) {
    return { file: shellPath, args: ["/c", command] };
  }
  if (shellName.includes("bash") || shellName.includes("zsh") || shellName.includes("sh")) {
    return { file: shellPath, args: ["-lc", command] };
  }
  return { file: shellPath, args: ["-c", command] };
}

function buildShellSessionInvocation(shellPath) {
  const shellName = String(shellPath || "").toLowerCase();
  if (shellName.includes("powershell") || shellName.includes("pwsh")) {
    return { file: shellPath, args: ["-NoLogo", "-NoProfile"] };
  }
  if (shellName.includes("cmd.exe") || shellName.endsWith("cmd")) {
    return { file: shellPath, args: ["/Q", "/K"] };
  }
  if (shellName.includes("bash") || shellName.includes("zsh") || shellName.includes("sh")) {
    return { file: shellPath, args: ["-i"] };
  }
  return { file: shellPath, args: [] };
}

function buildShellCdCommand(shellName, cwd) {
  if (!cwd) {
    return "";
  }
  const safePath = String(cwd).replace(/"/g, "\\\"");
  if (shellName.includes("powershell") || shellName.includes("pwsh")) {
    return `Set-Location -Path "${safePath}"`;
  }
  if (shellName.includes("cmd.exe") || shellName.endsWith("cmd")) {
    return `cd /d "${safePath}"`;
  }
  if (shellName.includes("bash") || shellName.includes("zsh") || shellName.includes("sh")) {
    return `cd "${safePath}"`;
  }
  return `cd "${safePath}"`;
}

function getShellPrompt(shellName, cwd) {
  if (shellName.includes("powershell") || shellName.includes("pwsh")) {
    return `PS ${cwd}>`;
  }
  if (shellName.includes("cmd.exe") || shellName.endsWith("cmd")) {
    return `${cwd}>`;
  }
  if (shellName.includes("bash") || shellName.includes("zsh") || shellName.includes("sh")) {
    return `${cwd}$`;
  }
  return `> ${cwd}`;
}

function resolveCommandCwd(workspaceFolder, cwdValue) {
  if (!cwdValue) {
    return workspaceFolder;
  }
  return ensureWorkspacePath(workspaceFolder, String(cwdValue).trim());
}

function scheduleDiffAutoClose(beforeUri, afterUri, delayMs) {
  const closeDelay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 2000;
  setTimeout(() => {
    const tabGroups = vscode.window.tabGroups;
    if (!tabGroups || !Array.isArray(tabGroups.all)) {
      return;
    }
    const beforeKey = beforeUri.toString();
    const afterKey = afterUri.toString();
    const tabsToClose = [];
    tabGroups.all.forEach((group) => {
      (group.tabs || []).forEach((tab) => {
        const input = tab.input;
        if (input instanceof vscode.TabInputTextDiff) {
          const originalKey = input.original?.toString();
          const modifiedKey = input.modified?.toString();
          if (originalKey === beforeKey && modifiedKey === afterKey) {
            tabsToClose.push(tab);
          }
        }
      });
    });
    if (tabsToClose.length > 0) {
      void tabGroups.close(tabsToClose, true);
    }
  }, closeDelay);
}

async function showDiffPreview(filePath, beforeText, afterText, label) {
  try {
    const originalDoc = await vscode.workspace.openTextDocument(filePath);
    const languageId = originalDoc.languageId || "plaintext";
    const beforeDoc = await vscode.workspace.openTextDocument({ content: beforeText || "", language: languageId });
    const afterDoc = await vscode.workspace.openTextDocument({ content: afterText || "", language: languageId });
    const title = label || `Changes: ${path.basename(filePath)}`;
    await vscode.commands.executeCommand("vscode.diff", beforeDoc.uri, afterDoc.uri, title, { preview: true });
    scheduleDiffAutoClose(beforeDoc.uri, afterDoc.uri, 2000);
  } catch (error) {
    // Ignore diff preview failures.
  }
}

const sharedCommandTerminal = {
  terminal: null,
  running: Promise.resolve(),
  disposeListener: null,
  dataListener: null,
  cwd: "",
  pending: null
};

function ensureCommandTerminal(shellPath) {
  if (sharedCommandTerminal.terminal) {
    return sharedCommandTerminal;
  }

  const options = { name: "Sarvam: Interactive" };
  if (shellPath) {
    options.shellPath = shellPath;
  }
  sharedCommandTerminal.terminal = vscode.window.createTerminal(options);
  if (!sharedCommandTerminal.dataListener) {
    sharedCommandTerminal.dataListener = vscode.window.onDidWriteTerminalData((event) => {
      if (event.terminal !== sharedCommandTerminal.terminal) {
        return;
      }
      const chunk = String(event.data || "");
      if (sharedCommandTerminal.pending) {
        sharedCommandTerminal.pending.collected += chunk;
        if (sharedCommandTerminal.pending.collected.includes(sharedCommandTerminal.pending.endMarker)) {
          const collected = sharedCommandTerminal.pending.collected;
          const startIndex = collected.indexOf(sharedCommandTerminal.pending.startMarker);
          const endIndex = collected.indexOf(sharedCommandTerminal.pending.endMarker);
          const extracted = startIndex >= 0 && endIndex > startIndex
            ? collected.slice(startIndex + sharedCommandTerminal.pending.startMarker.length, endIndex)
            : collected;
          const resultText = extracted
            .replace(sharedCommandTerminal.pending.startMarker, "")
            .replace(sharedCommandTerminal.pending.endMarker, "")
            .trim();
          const resolver = sharedCommandTerminal.pending.resolve;
          sharedCommandTerminal.pending = null;
          resolver(resultText || "(no output)");
        }
      }
    });
  }
  if (!sharedCommandTerminal.disposeListener) {
    sharedCommandTerminal.disposeListener = vscode.window.onDidCloseTerminal((closed) => {
      if (closed === sharedCommandTerminal.terminal) {
        sharedCommandTerminal.terminal = null;
        sharedCommandTerminal.running = Promise.resolve();
        sharedCommandTerminal.cwd = "";
        sharedCommandTerminal.pending = null;
      }
    });
  }
  return sharedCommandTerminal;
}

function runExecuteCommandInTerminal(command, workspaceFolder, shellPath, cwd) {
  const terminalState = ensureCommandTerminal(shellPath);
  // Always focus the terminal when sending a command
  terminalState.terminal.show(true);
  const normalizedCommand = normalizeShellCommand(command, shellPath);
  const displayCwd = cwd || workspaceFolder;
  const shellName = String(shellPath || "").toLowerCase();
  terminalState.running = terminalState.running.then(() => new Promise((resolve, reject) => {
    const runWithShell = () => {
      const marker = `__SARVAM_${Date.now()}__`;
      const startMarker = `${marker}_START`;
      const endMarker = `${marker}_END`;
      terminalState.pending = {
        startMarker,
        endMarker,
        resolve,
        reject,
        collected: ""
      };
      if (terminalState.cwd !== displayCwd) {
        const cdCommand = buildShellCdCommand(shellName, displayCwd);
        if (cdCommand) {
          terminalState.terminal.sendText(cdCommand, true);
        }
        terminalState.cwd = displayCwd;
      }
      terminalState.terminal.sendText(`echo ${startMarker}`, true);
      terminalState.terminal.sendText(normalizedCommand, true);
      terminalState.terminal.sendText(`echo ${endMarker}`, true);
    };
    runWithShell();
  }));

  return terminalState.running;
}

function runExecuteCommandInProcess(command, workspaceFolder, shellPath, cwd) {
  const resolvedCwd = cwd || workspaceFolder;
  // Normalize the command for shell compatibility (e.g., PowerShell)
  const normalizedCommand = normalizeShellCommand(command, shellPath);
  return new Promise((resolve) => {
    exec(normalizedCommand, {
      cwd: resolvedCwd,
      shell: shellPath || undefined,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      const output = `${stdout || ""}${stderr || ""}`.trim();
      if (error) {
        const message = error.message || "Command failed.";
        resolve(output ? `${output}\n${message}` : message);
        return;
      }
      resolve(output || "(no output)");
    });
  });
}

function parseTodoItems(raw) {
  if (!raw) {
    return [];
  }
  const items = [];
  const pattern = /(\[[ x-]\])\s*([^\[]+)/gi;
  let match;
  while ((match = pattern.exec(raw))) {
    const status = match[1].trim();
    const text = String(match[2] || "").trim();
    if (text) {
      items.push({ status, text });
    }
  }
  if (!items.length) {
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        items.push({ status: "[ ]", text: line });
      });
  }
  return items;
}

function parseTodoArgs(args) {
  const raw = args && args.todos ? args.todos.join("\n") : "";
  return parseTodoItems(raw);
}

function getToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read file contents.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative file path." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "list_files",
        description: "List files under a path.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative directory." },
            recursive: { type: "boolean", description: "Recurse into subdirectories." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "search_files",
        description: "Search files matching a regex.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative directory." },
            regex: { type: "string", description: "Regex to search for." },
            file_pattern: { type: "string", description: "File pattern (optional)." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "list_code_definition_names",
        description: "List top-level code definitions in a file or directory.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative file or directory." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "write_to_file",
        description: "Write content to a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative file path." },
            content: { type: "string", description: "File contents." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "apply_diff",
        description: "Apply a patch-style diff to a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative file path." },
            diff: { type: "string", description: "Diff block contents." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "search_and_replace",
        description: "Search and replace text in a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative file path." },
            search: { type: "string", description: "Search pattern." },
            replace: { type: "string", description: "Replacement value." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "insert_content",
        description: "Insert content at a line in a file.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Workspace-relative file path." },
            line: { type: "number", description: "1-based line number (0 = append)." },
            content: { type: "string", description: "Content to insert." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "execute_command",
        description: "Run a shell command.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Command to run." }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "update_todo_list",
        description: "Update the todo list.",
        parameters: {
          type: "object",
          properties: {
            todos: { type: "string", description: "Todo list entries." }
          }
        }
      }
    }
  ];
}

function listCheckpointFiles(workspaceFolder) {
  const fs = require("fs");
  const root = path.join(workspaceFolder, ".sarvam", "checkpoints");
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root).map((file) => path.join(root, file));
}

function readCheckpointFile(filePath) {
  const fs = require("fs");
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function resolveAutoApprove(toolName, autoApprove) {
  const writeTools = new Set(["write_to_file", "apply_diff", "search_and_replace", "insert_content"]);
  if (toolName === "read_file") {
    return false;
  }
  if (writeTools.has(toolName)) {
    return false;
  }
  if (toolName === "execute_command") {
    return false;
  }
  return Boolean(autoApprove && autoApprove.other);
}

class SarvamViewProvider {
  constructor(context) {
    this.context = context;
    this.systemPrompt = "";
    this.history = [];
    this.tasks = [];
    this.currentTaskId = null;
    this.pendingToolDecision = null;
    this.lastToolDecision = null;
    this.pendingFollowupChoice = null;
    this.lastFollowupChoice = null;
    this.processing = false;
    this.webview = null;
    this.settings = null;
  }

  resolveWebviewView(webviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")]
    };
    this.webview = webviewView.webview;
    const workspaceFolder = getWorkspaceFolder();
    const savedState = loadSarvamState(workspaceFolder);
    const legacySettings = this.context.workspaceState.get("sarvam.settings", null);
    const legacyTasks = this.context.workspaceState.get("sarvam.tasks", null);
    const legacyCurrentTaskId = this.context.workspaceState.get("sarvam.currentTaskId", null);
    const defaults = {
      baseUrl: "https://api.sarvam.ai/v1",
      apiKey: "",
      model: "sarvam-105b",
      contextWindow: 128000,
      toolMaxRepeat: 0
    };
    if (!savedState && (legacySettings || legacyTasks || legacyCurrentTaskId)) {
      saveSarvamState(workspaceFolder, {
        settings: legacySettings || null,
        tasks: legacyTasks || [],
        currentTaskId: legacyCurrentTaskId || null
      });
    }
    const persisted = savedState || loadSarvamState(workspaceFolder) || {};
    this.settings = persisted.settings || null;
    this.tasks = Array.isArray(persisted.tasks)
      ? persisted.tasks.map((task) => ({
        ...task,
        history: Array.isArray(task.history) ? task.history.map(normalizeHistoryEntry) : [],
        eventLog: Array.isArray(task.eventLog) ? task.eventLog : []
      }))
      : [];
    this.currentTaskId = persisted.currentTaskId || (this.tasks[0] && this.tasks[0].id) || null;
    if (!this.tasks.length) {
      const seedTask = {
        id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
        title: "Task 1",
        history: [],
        metrics: null,
        checkpoints: [],
        eventLog: [],
        followup: null
      };
      this.tasks = [seedTask];
      this.currentTaskId = seedTask.id;
      saveSarvamState(workspaceFolder, {
        settings: this.settings,
        tasks: this.tasks,
        currentTaskId: this.currentTaskId
      });
    }
    const activeTask = this.tasks.find((task) => task.id === this.currentTaskId) || this.tasks[0];
    this.history = activeTask ? (activeTask.history || []).map(normalizeHistoryEntry) : [];

    const ensureSettings = this.settings || defaults;
    this.settings = ensureSettings;

    const initialState = {
      firstRun: !this.settings || !this.settings.apiKey,
      defaults,
      settings: ensureSettings,
      hasConversation: this.history.length > 0
    };

    webviewView.webview.html = buildWebviewHtml(webviewView.webview, this.context.extensionUri, initialState);
    this.systemPrompt = buildSystemPrompt(
      this.context.extensionUri.fsPath,
      getWorkspaceFolder(),
      vscode.env.shell
    );
    webviewView.webview.postMessage({
      type: "autoApprove",
      value: getAutoApproveConfig()
    });
    webviewView.webview.postMessage({
      type: "history",
      value: buildDisplayHistory(this.history)
    });
    webviewView.webview.postMessage({
      type: "tasks",
      value: {
        tasks: this.tasks.map(({ id, title, metrics, history, checkpoints }) => ({
          id,
          title,
          metrics,
          preview: history && history.length ? (history[0].display || history[0].content) : "",
          checkpoints: checkpoints || []
        })),
        currentTaskId: this.currentTaskId
      }
    });
    webviewView.webview.postMessage({
      type: "metrics",
      value: activeTask && activeTask.metrics ? activeTask.metrics : { contextLength: 0, inputTokens: 0, outputTokens: 0, contextWindow: defaults.contextWindow }
    });

    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("sarvamCoder.autoApprove")) {
          send({ type: "autoApprove", value: getAutoApproveConfig() });
        }
      })
    );

    const send = (payload) => {
      if (this.webview) {
        this.webview.postMessage(payload);
      }
    };

    const logEvent = (entry) => {
      const item = { timestamp: new Date().toISOString(), ...entry };
      const activeTask = this.tasks.find((task) => task.id === this.currentTaskId);
      if (activeTask) {
        if (!Array.isArray(activeTask.eventLog)) {
          activeTask.eventLog = [];
        }
        activeTask.eventLog.push(item);
        saveSarvamState(workspaceFolder, {
          settings: this.settings,
          tasks: this.tasks,
          currentTaskId: this.currentTaskId
        });
      }
      if (entry.taskId === this.currentTaskId) {
        send({ type: "eventLog", value: item });
      }
    };

    const runModel = async (userContent) => {
      if (this.processing) {
        send({ type: "error", value: "A request is already running. Please wait for it to finish." });
        logEvent({
          level: "warn",
          phase: "request",
          message: "Ignored user message while request was running",
          detail: truncateText(userContent, 220),
          taskId: this.currentTaskId
        });
        return;
      }

      this.pendingToolDecision = null;
      this.pendingFollowupChoice = null;
      this.lastFollowupChoice = null;

      const settings = this.settings || defaults;
      if (!settings || !settings.baseUrl || !settings.apiKey || !settings.model || !settings.contextWindow) {
        send({ type: "error", value: "Provider settings are incomplete." });
        return;
      }

      if (this.history.length === 0) {
        writeInitialCheckpoint(getWorkspaceFolder(), {
          timestamp: new Date().toISOString(),
          systemPrompt: this.systemPrompt,
          userMessage: userContent,
          taskId: this.currentTaskId
        });
      }

      this.processing = true;
      const requestId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      send({ type: "toolRequestClear" });
      logEvent({
        level: "info",
        phase: "request",
        message: "Request started",
        detail: `Prompt: ${truncateText(userContent, 220)}`,
        taskId: this.currentTaskId,
        requestId
      });
      this.history.push(createHistoryEntry("user", userContent, userContent, userContent));
      const activeTask = this.tasks.find((task) => task.id === this.currentTaskId);
      if (activeTask) {
        activeTask.history = this.history;
      }
      saveSarvamState(workspaceFolder, {
        settings: this.settings,
        tasks: this.tasks,
        currentTaskId: this.currentTaskId
      });

      let loopGuard = 0;
      const maxLoops = 8;
      const repeatConfig = vscode.workspace.getConfiguration("sarvamCoder");
      const configuredMaxRepeat = Number(repeatConfig.get("tool.maxRepeat", 0)) || 0;
      const maxRepeat = Math.max(0, Math.floor(configuredMaxRepeat));
      let lastToolSignature = null;
      let repeatCount = 0;
      let finalAttempted = false;
      let finalDelivered = false;
      let messages = buildModelMessages(this.systemPrompt, this.history);

      while (loopGuard < maxLoops) {
        loopGuard += 1;
        let assistantText = "";
        let usage = null;

        try {
          const payloadSummary = {
            model: settings.model,
            messageCount: messages.length,
            messages: summarizeMessages(messages, 8)
          };
          const rawRequest = JSON.stringify({ model: settings.model, messages }, null, 2);
          logEvent({
            level: "info",
            phase: "request",
            message: "Request payload",
            detail: truncateText(JSON.stringify(payloadSummary), 900),
            rawRequest,
            taskId: this.currentTaskId,
            requestId
          });
          const result = await streamChatCompletions({
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            messages,
            onDelta: (delta) => {
              assistantText += delta;
              send({ type: "assistantDelta", value: delta });
            }
          });
          assistantText = result.assistantText;
          usage = result.usage;
          const responseDetail = usage
            ? `Tokens in/out: ${usage.prompt_tokens ?? "?"}/${usage.completion_tokens ?? "?"}`
            : "";
          const rawSnippet = assistantText || "";
          const displaySnippet = stripToolXml(assistantText);
          logEvent({
            level: "info",
            phase: "response",
            message: "Model response received",
            detail: responseDetail,
            rawResponse: rawSnippet,
            finalResponse: displaySnippet,
            taskId: this.currentTaskId,
            requestId
          });
        } catch (error) {
          const message = error.message || "Request failed.";
          this.history.push({ role: "error", content: message });
          if (activeTask) {
            activeTask.history = this.history;
          }
          saveSarvamState(workspaceFolder, {
            settings: this.settings,
            tasks: this.tasks,
            currentTaskId: this.currentTaskId
          });
          send({ type: "error", value: message });
          logEvent({ level: "error", phase: "response", message, taskId: this.currentTaskId, requestId });
          break;
        }

        const completionText = extractAttemptCompletion(assistantText);
        const displayText = completionText || stripToolXml(assistantText);
        const toolCall = extractToolCall(assistantText);
        const assistantMessage = createHistoryEntry("assistant", displayText, assistantText, displayText);

        const inputTokens = usage?.prompt_tokens ?? approximateTokens(messages.map((m) => m.content).join("\n"));
        const outputTokens = usage?.completion_tokens ?? approximateTokens(assistantText);
        const metrics = {
          contextLength: inputTokens + outputTokens,
          inputTokens,
          outputTokens,
          contextWindow: settings.contextWindow
        };
        if (activeTask) {
          activeTask.metrics = metrics;
        }
        saveSarvamState(workspaceFolder, {
          settings: this.settings,
          tasks: this.tasks,
          currentTaskId: this.currentTaskId
        });
        send({ type: "metrics", value: metrics });
        send({
          type: "tasks",
          value: {
            tasks: this.tasks.map(({ id, title, metrics, history, checkpoints }) => ({
              id,
              title,
              metrics,
              preview: history && history.length ? (history[0].display || history[0].content) : "",
              checkpoints: checkpoints || []
            })),
            currentTaskId: this.currentTaskId
          }
        });

        if (!toolCall) {
          if (!displayText && !finalAttempted) {
            finalAttempted = true;
            const finalPrompt = "Provide the final response now using the tool results above. Do not call any tools.";
            logEvent({
              level: "info",
              phase: "response",
              message: "Retrying for final response",
              taskId: this.currentTaskId,
              requestId
            });
            messages = [...messages, { role: "user", content: finalPrompt }];
            loopGuard = 0;
            continue;
          }
          if (displayText) {
            this.history.push(assistantMessage);
            if (activeTask) {
              activeTask.history = this.history;
            }
            saveSarvamState(workspaceFolder, {
              settings: this.settings,
              tasks: this.tasks,
              currentTaskId: this.currentTaskId
            });
            send({ type: "assistantDone", value: { text: displayText, raw: assistantText } });
            finalDelivered = true;
          }
          break;
        }
        if (toolCall.name === "tool_call") {
          this.history.push(assistantMessage);
          if (activeTask) {
            activeTask.history = this.history;
          }
          saveSarvamState(workspaceFolder, {
            settings: this.settings,
            tasks: this.tasks,
            currentTaskId: this.currentTaskId
          });
          send({ type: "assistantDone", value: { text: displayText, raw: assistantText } });
          break;
        }
        if (!toolCall.name) {
          logEvent({
            level: "error",
            phase: "response",
            message: "Ignored tool call with missing name",
            taskId: this.currentTaskId,
            requestId
          });
          break;
        }
        if (toolCall.name === "title_name") {
          this.history.push(assistantMessage);
          if (activeTask) {
            activeTask.history = this.history;
          }
          saveSarvamState(workspaceFolder, {
            settings: this.settings,
            tasks: this.tasks,
            currentTaskId: this.currentTaskId
          });
          send({ type: "assistantDone", value: { text: displayText, raw: assistantText } });
          const titleValue =
            (toolCall.args.value && toolCall.args.value[0]) ||
            (toolCall.args.title && toolCall.args.title[0]) ||
            (toolCall.args.name && toolCall.args.name[0]);
          if (activeTask && titleValue) {
            activeTask.title = titleValue.trim();
            saveSarvamState(workspaceFolder, {
              settings: this.settings,
              tasks: this.tasks,
              currentTaskId: this.currentTaskId
            });
            send({
              type: "tasks",
              value: {
                tasks: this.tasks.map(({ id, title, metrics, history, checkpoints }) => ({
                  id,
                  title,
                  metrics,
                  preview: history && history.length ? (history[0].display || history[0].content) : "",
                  checkpoints: checkpoints || []
                })),
                currentTaskId: this.currentTaskId
              }
            });
          }
          break;
        }

        if (toolCall.name === "ask_followup_question") {
          if (displayText) {
            this.history.push(assistantMessage);
            if (activeTask) {
              activeTask.history = this.history;
            }
            saveSarvamState(workspaceFolder, {
              settings: this.settings,
              tasks: this.tasks,
              currentTaskId: this.currentTaskId
            });
          }
          send({ type: "assistantDone", value: { text: displayText, raw: assistantText } });
          const followup = parseFollowupOptions(toolCall);
          if (activeTask) {
            activeTask.followup = {
              question: followup.question || "",
              options: followup.options || [],
              selected: ""
            };
            saveSarvamState(workspaceFolder, {
              settings: this.settings,
              tasks: this.tasks,
              currentTaskId: this.currentTaskId
            });
          }
          const followupDisplay = formatFollowupDisplay(followup);
          this.history.push(createHistoryEntry("assistant", followupDisplay, followupDisplay, followupDisplay));
          if (activeTask) {
            activeTask.history = this.history;
          }
          saveSarvamState(workspaceFolder, {
            settings: this.settings,
            tasks: this.tasks,
            currentTaskId: this.currentTaskId
          });
          send({ type: "historyAppend", value: { role: "assistant", content: followupDisplay, raw: followupDisplay } });
          logEvent({
            level: "info",
            phase: "response",
            message: "Follow-up requested",
            detail: truncateText(followup.question || "(no question)", 240),
            taskId: this.currentTaskId,
            requestId
          });
          send({ type: "followupPrompt", value: followup });
          const choice = await new Promise((resolve) => {
            this.pendingFollowupChoice = resolve;
            if (this.lastFollowupChoice) {
              const value = this.lastFollowupChoice;
              this.lastFollowupChoice = null;
              resolve(value);
            }
          });
          this.pendingFollowupChoice = null;
          send({ type: "followupClear" });
          logEvent({
            level: "info",
            phase: "response",
            message: "Follow-up selected",
            detail: truncateText(choice, 240),
            taskId: this.currentTaskId,
            requestId
          });
          if (choice) {
            if (activeTask) {
              if (!activeTask.followup) {
                activeTask.followup = {
                  question: followup.question || "",
                  options: followup.options || [],
                  selected: choice
                };
              } else {
                activeTask.followup.selected = choice;
              }
            }
            const userDisplay = `User entered: ${choice}`;
            this.history.push(createHistoryEntry("user", userDisplay, choice, choice));
            if (activeTask) {
              activeTask.history = this.history;
            }
            saveSarvamState(workspaceFolder, {
              settings: this.settings,
              tasks: this.tasks,
              currentTaskId: this.currentTaskId
            });
            send({ type: "historyAppend", value: { role: "user", content: userDisplay, raw: choice } });
            messages = buildModelMessages(this.systemPrompt, this.history);
          }
          continue;
        }

        send({ type: "assistantDone", value: { text: displayText, raw: assistantText } });

        const toolSignature = `${toolCall.name}:${JSON.stringify(toolCall.args || {})}`;
        if (toolSignature === lastToolSignature) {
          repeatCount += 1;
        } else {
          repeatCount = 0;
          lastToolSignature = toolSignature;
        }
        const shouldStopRepeat = maxRepeat === 0 ? repeatCount > 0 : repeatCount >= maxRepeat;
        if (shouldStopRepeat) {
          if (!finalAttempted) {
            finalAttempted = true;
            repeatCount = 0;
            lastToolSignature = null;
            const finalPrompt = "Provide the final response now using the tool results above. Do not call any tools.";
            logEvent({
              level: "info",
              phase: "response",
              message: "Requesting final response without tools",
              taskId: this.currentTaskId,
              requestId
            });
            messages = [...messages, { role: "user", content: finalPrompt }];
            loopGuard = 0;
            continue;
          }
          const notice = `Stopped repeated tool call: ${toolCall.name}`;
          const detail = `Signature: ${truncateText(toolSignature, 400)}`;
          send({ type: "error", value: notice });
          logEvent({ level: "error", phase: "response", message: notice, detail, taskId: this.currentTaskId, requestId });
          break;
        }

        const autoApprove = getAutoApproveConfig();
        const shouldAutoApprove = resolveAutoApprove(toolCall.name, autoApprove);
        if (!shouldAutoApprove) {
          const toolSummary = summarizeToolRequest(toolCall);
          send({
            type: "toolRequest",
            value: {
              name: toolCall.name,
              summary: toolSummary.title,
              detail: toolSummary.detail,
              raw: toolCall.raw,
              autoApproved: shouldAutoApprove
            }
          });
        } else {
          send({ type: "autoTool", value: { name: toolCall.name } });
        }
        const toolArgs = summarizeToolArgs(toolCall.args);
        logEvent({
          level: "info",
          phase: "response",
          message: `Tool requested: ${toolCall.name}`,
          detail: toolArgs ? `Args: ${toolArgs}` : "",
          taskId: this.currentTaskId,
          requestId
        });

        let decision = "reject";
        if (shouldAutoApprove) {
          decision = "approve";
        } else {
          decision = await new Promise((resolve) => {
            this.pendingToolDecision = resolve;
          });
        }

        send({ type: "toolDecisionAck", value: decision });

        this.pendingToolDecision = null;
        if (decision !== "approve") {
          this.history.push(assistantMessage);
          if (activeTask) {
            activeTask.history = this.history;
          }
          saveSarvamState(workspaceFolder, {
            settings: this.settings,
            tasks: this.tasks,
            currentTaskId: this.currentTaskId
          });
          send({ type: "toolRequestClear" });
          send({ type: "toolResult", value: { name: toolCall.name, result: "Tool rejected." } });
          break;
        }

        this.history.push(assistantMessage);
        if (activeTask) {
          activeTask.history = this.history;
        }
        saveSarvamState(workspaceFolder, {
          settings: this.settings,
          tasks: this.tasks,
          currentTaskId: this.currentTaskId
        });

        let toolResult = "";
        let preWriteExists = false;
        try {
          send({ type: "toolRequestClear" });
          logEvent({
            level: "info",
            phase: "response",
            message: `Tool executing: ${toolCall.name}`,
            detail: toolArgs ? `Args: ${toolArgs}` : "",
            taskId: this.currentTaskId,
            requestId
          });
          const writeTools = new Set(["write_to_file", "apply_diff", "search_and_replace", "insert_content"]);
          const shouldPreviewDiff = writeTools.has(toolCall.name);
          let previewPath = "";
          let beforeSnapshot = "";
          if (shouldPreviewDiff) {
            previewPath = String((toolCall.args.path && toolCall.args.path[0]) || "").trim();
            if (previewPath) {
              const absolutePath = ensureWorkspacePath(getWorkspaceFolder(), previewPath);
              beforeSnapshot = readFileSafe(absolutePath);
              preWriteExists = fs.existsSync(absolutePath);
            }
          }
          if (writeTools.has(toolCall.name)) {
            createCheckpoint(getWorkspaceFolder(), {
              timestamp: new Date().toISOString(),
              taskId: this.currentTaskId,
              toolCall: toolCall.raw
            }, "pre-write");
          }
          if (toolCall.name === "execute_command") {
            const commandValue = (toolCall.args.command && toolCall.args.command[0]) || "";
            const cwdValue = toolCall.args.cwd && toolCall.args.cwd[0] ? toolCall.args.cwd[0] : "";
            if (!commandValue) {
              toolResult = "No command provided.";
            } else {
              const workspaceFolder = getWorkspaceFolder();
              const allowCwdOverride = vscode.workspace.getConfiguration("sarvamCoder").get("execute.allowCwdOverride", false);
              const commandCwd = allowCwdOverride ? resolveCommandCwd(workspaceFolder, cwdValue) : workspaceFolder;
              const config = vscode.workspace.getConfiguration("sarvamCoder");
              const captureMode = config.get("execute.captureMode", "terminal");
              if (captureMode === "terminal") {
                toolResult = await runExecuteCommandInTerminal(commandValue, workspaceFolder, vscode.env.shell, commandCwd);
              } else {
                const showTerminal = config.get("execute.showTerminalOnProcess", false);
                if (showTerminal) {
                  ensureCommandTerminal(vscode.env.shell).terminal.show(true);
                }
                toolResult = await runExecuteCommandInProcess(commandValue, workspaceFolder, vscode.env.shell, commandCwd);
              }
            }
          } else {
            toolResult = await runTool(getWorkspaceFolder(), toolCall);
          }
          if (shouldPreviewDiff && previewPath) {
            const absolutePath = ensureWorkspacePath(getWorkspaceFolder(), previewPath);
            const afterSnapshot = readFileSafe(absolutePath);
            if (beforeSnapshot !== afterSnapshot) {
              void showDiffPreview(absolutePath, beforeSnapshot, afterSnapshot, `Changes: ${previewPath}`);
            }
          }
        } catch (error) {
          toolResult = `Tool error: ${error.message}`;
        }
        logEvent({
          level: "info",
          phase: "response",
          message: `Tool result: ${toolCall.name}`,
          detail: `Result: ${truncateText(toolResult, 240)}`,
          taskId: this.currentTaskId,
          requestId
        });

        send({ type: "toolRequestClear" });
        if (toolCall.name === "update_todo_list") {
          send({ type: "todoList", value: parseTodoArgs(toolCall.args) });
        }
        send({ type: "toolResult", value: { name: toolCall.name, result: toolResult } });
        const safeToolResult = escapeToolResultForModel(toolResult);
        const toolSummary = formatToolResultSummary(toolCall, { preWriteExists });
        const summaryText = toolSummary ? ` ${toolSummary}` : "";
        const displayToolResult = `Tool result (${toolCall.name}):${summaryText}\n${toolResult}`;
        const modelToolResult = `Tool result (${toolCall.name}):\n${typeof safeToolResult === 'string' ? safeToolResult : String(safeToolResult)}`;
        this.history.push(createHistoryEntry("tool-execution", displayToolResult, displayToolResult, modelToolResult));
        if (activeTask && this.history.length > 0) {
          activeTask.history = this.history;
        }
        saveSarvamState(workspaceFolder, {
          settings: this.settings,
          tasks: this.tasks,
          currentTaskId: this.currentTaskId
        });
        send({
          type: "historyAppend",
          value: {
            role: "tool-execution",
            content: `Tool result (${toolCall.name}):\n${toolResult}`,
            raw: `Tool result (${toolCall.name}):\n${toolResult}`
          }
        });
        messages = buildModelMessages(this.systemPrompt, this.history);
        if (loopGuard >= maxLoops - 1 && !finalAttempted) {
          finalAttempted = true;
          const finalPrompt = "Provide the final response now using the tool results above. Do not call any tools.";
          messages = [...messages, { role: "user", content: finalPrompt }];
        }
      }

      if (loopGuard >= maxLoops && !finalDelivered) {
        const notice = "Model stopped after repeated tool calls without a final response.";
        send({ type: "error", value: notice });
        logEvent({ level: "error", phase: "response", message: notice, taskId: this.currentTaskId, requestId });
      }

      this.processing = false;
      logEvent({
        level: "info",
        phase: "response",
        message: "Request finished",
        taskId: this.currentTaskId,
        requestId
      });
    };

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message || !message.type) {
        return;
      }

      const defaults = {
        baseUrl: "https://api.sarvam.ai/v1",
        apiKey: "",
        model: "sarvam-105b",
        contextWindow: 128000,
        toolMaxRepeat: 0
      };

      if (message.type === "saveSettings") {
        const settings = message.value || {};
        this.settings = settings;
        if (typeof settings.toolMaxRepeat === "number" && Number.isFinite(settings.toolMaxRepeat)) {
          await vscode.workspace.getConfiguration("sarvamCoder").update(
            "tool.maxRepeat",
            Math.max(0, Math.floor(settings.toolMaxRepeat)),
            vscode.ConfigurationTarget.Workspace
          );
        }
        saveSarvamState(workspaceFolder, {
          settings: this.settings,
          tasks: this.tasks,
          currentTaskId: this.currentTaskId
        });
        webviewView.webview.html = buildWebviewHtml(webviewView.webview, this.context.extensionUri, {
          firstRun: false,
          defaults,
          settings
        });
        return;
      }

      if (message.type === "resetSettings") {
        this.settings = defaults;
        await vscode.workspace.getConfiguration("sarvamCoder").update(
          "tool.maxRepeat",
          defaults.toolMaxRepeat,
          vscode.ConfigurationTarget.Workspace
        );
        saveSarvamState(workspaceFolder, {
          settings: this.settings,
          tasks: this.tasks,
          currentTaskId: this.currentTaskId
        });
        webviewView.webview.html = buildWebviewHtml(webviewView.webview, this.context.extensionUri, {
          firstRun: true,
          defaults,
          settings: defaults
        });
        return;
      }

      if (message.type === "showSystemPrompt") {
        showSystemPromptPanel(this.context, this.systemPrompt);
        return;
      }

      if (message.type === "showSystemPromptFromLog") {
        const promptValue = String(message.value || this.systemPrompt);
        showSystemPromptPanel(this.context, promptValue);
        return;
      }

      if (message.type === "userMessage") {
        const content = String(message.value || "").trim();
        if (!content) {
          return;
        }
        await runModel(content);
        return;
      }

      if (message.type === "toolDecision" && this.pendingToolDecision) {
        this.pendingToolDecision(message.value || "reject");
        return;
      }

      if (message.type === "followupChoice" && this.pendingFollowupChoice) {
        this.pendingFollowupChoice(String(message.value || "").trim());
        return;
      }

      if (message.type === "followupChoice") {
        this.lastFollowupChoice = String(message.value || "").trim();
        return;
      }

      if (message.type === "toolDecision") {
        logEvent({
          level: "info",
          phase: "response",
          message: "Tool decision received without pending request",
          taskId: this.currentTaskId
        });
        return;
      }

      if (message.type === "showEventLog") {
        const activeTask = this.tasks.find((task) => task.id === this.currentTaskId);
        send({ type: "eventLogSnapshot", value: activeTask && activeTask.eventLog ? activeTask.eventLog : [] });
        return;
      }

      if (message.type === "addTask") {
        const newTaskId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
        const newTask = {
          id: newTaskId,
          title: message.value || `Task ${this.tasks.length + 1}`,
          history: [],
          metrics: { contextLength: 0, inputTokens: 0, outputTokens: 0, contextWindow: defaults.contextWindow },
          checkpoints: [],
          eventLog: [],
          followup: null
        };
        this.tasks.unshift(newTask);
        this.currentTaskId = newTaskId;
        this.history = [];
        saveSarvamState(workspaceFolder, {
          settings: this.settings,
          tasks: this.tasks,
          currentTaskId: this.currentTaskId
        });
        send({
          type: "tasks",
          value: {
            tasks: this.tasks.map(({ id, title, metrics, history, checkpoints }) => ({
              id,
              title,
              metrics,
              preview: history && history.length ? (history[0].display || history[0].content) : "",
              checkpoints: checkpoints || []
            })),
            currentTaskId: this.currentTaskId
          }
        });
        send({ type: "history", value: [] });
        send({ type: "metrics", value: { contextLength: 0, inputTokens: 0, outputTokens: 0, contextWindow: defaults.contextWindow } });
        send({ type: "followupClear" });
        return;
      }

      if (message.type === "selectTask") {
        const taskId = message.value;
        const task = this.tasks.find((item) => item.id === taskId);
        if (task) {
          this.currentTaskId = taskId;
          this.history = task.history || [];
          saveSarvamState(workspaceFolder, {
            settings: this.settings,
            tasks: this.tasks,
            currentTaskId: this.currentTaskId
          });
          send({ type: "history", value: buildDisplayHistory(this.history) });
          send({ type: "metrics", value: task.metrics || { contextLength: 0, inputTokens: 0, outputTokens: 0, contextWindow: defaults.contextWindow } });
          send({
            type: "tasks",
            value: {
              tasks: this.tasks.map(({ id, title, metrics, history, checkpoints }) => ({
                id,
                title,
                metrics,
                preview: history && history.length ? (history[0].display || history[0].content) : "",
                checkpoints: checkpoints || []
              })),
              currentTaskId: this.currentTaskId
            }
          });
          const hasFollowup = task.followup && (task.followup.question || (task.followup.options && task.followup.options.length));
          const hasSelection = Boolean(task.followup && task.followup.selected);
          if (hasFollowup && !hasSelection) {
            send({
              type: "followupPrompt",
              value: {
                question: task.followup.question || "",
                options: task.followup.options || [],
                selected: task.followup.selected || ""
              }
            });
          } else {
            send({ type: "followupClear" });
          }
        }
        return;
      }

      if (message.type === "deleteTask") {
        const taskId = message.value;
        this.tasks = this.tasks.filter((item) => item.id !== taskId);
        if (!this.tasks.length) {
          const seedTask = {
            id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
            title: "Task 1",
            history: [],
            metrics: { contextLength: 0, inputTokens: 0, outputTokens: 0, contextWindow: defaults.contextWindow },
            checkpoints: [],
            eventLog: [],
            followup: null
          };
          this.tasks = [seedTask];
        }
        if (!this.tasks.find((item) => item.id === this.currentTaskId)) {
          this.currentTaskId = this.tasks[0].id;
        }
        const activeTask = this.tasks.find((item) => item.id === this.currentTaskId);
        this.history = activeTask ? activeTask.history || [] : [];
        saveSarvamState(workspaceFolder, {
          settings: this.settings,
          tasks: this.tasks,
          currentTaskId: this.currentTaskId
        });
        send({
          type: "tasks",
          value: {
            tasks: this.tasks.map(({ id, title, metrics, history, checkpoints }) => ({
              id,
              title,
              metrics,
              preview: history && history.length ? (history[0].display || history[0].content) : "",
              checkpoints: checkpoints || []
            })),
            currentTaskId: this.currentTaskId
          }
        });
        send({ type: "history", value: buildDisplayHistory(this.history) });
        send({ type: "metrics", value: activeTask && activeTask.metrics ? activeTask.metrics : { contextLength: 0, inputTokens: 0, outputTokens: 0, contextWindow: defaults.contextWindow } });
        if (!activeTask || !activeTask.followup || !activeTask.followup.selected) {
          send({ type: "followupClear" });
        }
        send({
          type: "tasks",
          value: {
            tasks: this.tasks.map(({ id, title, metrics, history, checkpoints }) => ({
              id,
              title,
              metrics,
              preview: history && history.length ? (history[0].display || history[0].content) : "",
              checkpoints: checkpoints || []
            })),
            currentTaskId: this.currentTaskId
          }
        });
        return;
      }

      if (message.type === "restoreCheckpoint") {
        const checkpointId = message.value;
        const activeTask = this.tasks.find((task) => task.id === this.currentTaskId);
        const checkpoint = activeTask && activeTask.checkpoints ? activeTask.checkpoints.find((item) => item.id === checkpointId) : null;
        if (checkpoint && checkpoint.files && checkpoint.files.length) {
          try {
            restoreCheckpointSnapshot(getWorkspaceFolder(), checkpoint);
            send({ type: "toolResult", value: { name: "restore", result: `Restored ${checkpoint.label}` } });
          } catch (error) {
            send({ type: "error", value: error.message });
          }
        }
      }
    });
  }
}

function activate(context) {
  // Auto-reload disabled; use explicit command instead.
  void vscode.commands.executeCommand(
    "setContext",
    "sarvamCoder.isDevelopment",
    context.extensionMode === vscode.ExtensionMode.Development
  );

  const provider = new SarvamViewProvider(context);
  const registration = vscode.window.registerWebviewViewProvider("sarvamCoder.sidebar", provider, {
    webviewOptions: { retainContextWhenHidden: true }
  });

  const openCommand = vscode.commands.registerCommand("sarvamCoder.open", async () => {
    await vscode.commands.executeCommand("workbench.view.extension.sarvam");
  });

  const reloadCommand = vscode.commands.registerCommand("sarvamCoder.reload", async () => {
    await vscode.commands.executeCommand("workbench.action.reloadWindow");
  });

  const restoreCheckpointCommand = vscode.commands.registerCommand("sarvamCoder.restoreCheckpoint", async (filePath) => {
    try {
      const checkpoint = readCheckpointFile(filePath);
      restoreCheckpointSnapshot(getWorkspaceFolder(), checkpoint);
      void vscode.window.showInformationMessage("Checkpoint restored.");
    } catch (error) {
      void vscode.window.showErrorMessage(`Restore failed: ${error.message}`);
    }
  });

  const timelineProvider = {
    async provideTimeline(uri) {
      const workspaceFolder = getWorkspaceFolder();
      const relPath = path.relative(workspaceFolder, uri.fsPath);
      const files = listCheckpointFiles(workspaceFolder);
      const items = [];
      for (const filePath of files) {
        try {
          const checkpoint = readCheckpointFile(filePath);
          const snapshots = checkpoint.files || [];
          const hit = snapshots.find((snap) => snap.path === relPath);
          if (hit) {
            const timestamp = checkpoint.timestamp ? new Date(checkpoint.timestamp) : new Date();
            const item = new vscode.TimelineItem(
              `${checkpoint.label || "checkpoint"}`,
              timestamp,
              vscode.TimelineItemCollapsibleState.Collapsed
            );
            item.detail = `Sarvam checkpoint: ${checkpoint.label || "checkpoint"}`;
            item.command = {
              command: "sarvamCoder.restoreCheckpoint",
              title: "Restore checkpoint",
              arguments: [filePath]
            };
            items.push(item);
          }
        } catch (error) {
          // Ignore bad checkpoint files.
        }
      }
      return { items }; 
    }
  };

  const timelineRegistration = vscode.workspace.registerTimelineProvider({ scheme: "file" }, timelineProvider);

  context.subscriptions.push(registration, openCommand, reloadCommand, restoreCheckpointCommand, timelineRegistration);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
