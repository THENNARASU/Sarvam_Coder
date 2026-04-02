const vscode = require("vscode");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { buildSystemPrompt } = require("./lib/prompt");
const { streamChatCompletions } = require("./lib/sarvam");
const { extractToolCall, runTool } = require("./lib/tools");
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
      <div class="brand-logo-frame" aria-label="Sarvam Coder">
        <img class="brand-logo" src="${iconUri}" alt="Sarvam Coder" />
      </div>
      <div class="topbar-actions">
        <button class="task-add" type="button" aria-label="Add task">New</button>
        <button class="task-history" type="button" aria-label="Task history">History</button>
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
        <p class="hint">Total tokens (input and output)</p>
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
        <p class="hint">Total tokens (input and output).</p>
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
        <div class="tool-approval__title">Waiting for approval</div>
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
        <div class="ready-input-actions">
          <button class="send-button" type="button" aria-label="Send" title="Send">&gt;</button>
          <button class="stop-button" type="button" aria-label="Stop request" title="Stop request" hidden>&#9632;</button>
        </div>
      </div>
      <div class="auto-approve" role="group" aria-label="Auto Approve">
        <span class="auto-approve__title">Auto Approve:</span>
        <label class="auto-approve__option">Read <input type="checkbox" data-auto-approve-read /></label>
        <label class="auto-approve__option">Write <input type="checkbox" data-auto-approve-write /></label>
        <label class="auto-approve__option">Run <input type="checkbox" data-auto-approve-execute /></label>
      </div>
    </section>
    <aside class="eventlog-view" aria-label="Event log" aria-hidden="true">
      <div class="eventlog-header">
        <div class="eventlog-title">Background Log</div>
        <div class="eventlog-header-actions">
          <button class="eventlog-copy" type="button">Copy</button>
          <button class="eventlog-close" type="button">Done</button>
        </div>
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
      font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: var(--vscode-editor-font-family, "Consolas", "Courier New", monospace);
      font-size: 12px;
      background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-panel-border, var(--vscode-contrastBorder));
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

function getDefaultAutoApproveConfig() {
  return {
    read: true,
    write: false,
    execute: false
  };
}

function normalizeAutoApproveConfig(value) {
  const defaults = getDefaultAutoApproveConfig();
  const input = value && typeof value === "object" ? value : {};
  return {
    read: typeof input.read === "boolean" ? input.read : defaults.read,
    write: typeof input.write === "boolean" ? input.write : defaults.write,
    execute: typeof input.execute === "boolean" ? input.execute : defaults.execute
  };
}

function createHistoryEntry(role, displayText, rawText, modelText, options = {}) {
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
    model: modelText || displayValue || "",
    checkpoint: options.checkpoint || null
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
    model: modelText,
    checkpoint: entry.checkpoint || null
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
      const compactContent = String(content || "").trim();
      if ((entry.role === "tool-execution" || entry.role === "tool_execution") && /^Checkpoint created\b/i.test(compactContent)) {
        return false;
      }
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
      raw: normalized.raw || "",
      checkpoint: normalized.checkpoint || null
    };
  });
}

function getCheckpointRoot(workspaceFolder) {
  return path.join(workspaceFolder, ".sarvam", "checkpoints");
}

function sanitizeCheckpointLabel(value) {
  return String(value || "checkpoint")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "checkpoint";
}

function createRestoreCheckpoint(workspaceFolder, payload) {
  const root = getCheckpointRoot(workspaceFolder);
  const timestamp = new Date().toISOString();
  const stamp = timestamp.replace(/[:.]/g, "-");
  const checkpointId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const label = payload.label || `Before ${payload.toolName || "write"}: ${payload.targetPath || "file"}`;
  const fileName = `${stamp}-${sanitizeCheckpointLabel(payload.taskId || "task")}-${sanitizeCheckpointLabel(payload.toolName || "write")}.json`;
  const filePath = path.join(root, fileName);
  const checkpoint = {
    id: checkpointId,
    timestamp,
    taskId: payload.taskId || "",
    label,
    toolName: payload.toolName || "",
    toolCall: payload.toolCall || "",
    checkpointType: payload.checkpointType || "snapshot",
    gitStashId: payload.gitStashId || null,
    files: Array.isArray(payload.files) ? payload.files : []
  };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), "utf8");
  return {
    ...checkpoint,
    checkpointFile: path.relative(workspaceFolder, filePath)
  };
}

function restoreCheckpointSnapshot(workspaceFolder, checkpoint) {
  const checkpointType = String(checkpoint?.checkpointType || "snapshot").toLowerCase();
  
  if (checkpointType === "git" && checkpoint?.gitStashId) {
    // Git-based checkpoint: attempt restore via git stash pop
    const stashId = checkpoint.gitStashId;
    exec(`git stash pop ${stashId}`, { cwd: workspaceFolder }, (error) => {
      if (error) {
        console.warn(`Failed to restore git stash ${stashId}: ${error.message}`);
      }
    });
    return;
  }
  
  // Snapshot-based checkpoint: restore files
  const snapshots = Array.isArray(checkpoint?.files) ? checkpoint.files : [];
  if (!snapshots.length) {
    throw new Error("Checkpoint has no restorable file snapshots.");
  }
  snapshots.forEach((snapshot) => {
    const targetPath = String(snapshot.path || "").trim();
    if (!targetPath) {
      return;
    }
    const absolutePath = ensureWorkspacePath(workspaceFolder, targetPath);
    const existedBefore = Boolean(snapshot.existedBefore);
    if (!existedBefore) {
      if (fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
      return;
    }
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, String(snapshot.content || ""), "utf8");
  });
}

function deleteCheckpointFile(workspaceFolder, checkpoint) {
  const checkpointFile = checkpoint && checkpoint.checkpointFile ? String(checkpoint.checkpointFile) : "";
  if (!checkpointFile) {
    return;
  }
  const absolutePath = ensureWorkspacePath(workspaceFolder, checkpointFile);
  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
}

function deleteTaskCheckpoints(workspaceFolder, task) {
  const taskId = String(task?.id || task?.taskId || "").trim();
  const checkpointList = Array.isArray(task?.checkpoints) ? task.checkpoints : [];
  const knownIds = new Set(
    checkpointList
      .map((checkpoint) => String(checkpoint?.id || "").trim())
      .filter(Boolean)
  );
  const files = listCheckpointFiles(workspaceFolder);

  checkpointList.forEach((checkpoint) => {
    try {
      deleteCheckpointFile(workspaceFolder, checkpoint);
    } catch (error) {
      // Ignore checkpoint cleanup failures for deleted tasks.
    }
  });

  files.forEach((filePath) => {
    try {
      const checkpoint = readCheckpointFile(filePath);
      const fileTaskId = String(checkpoint?.taskId || "").trim();
      const checkpointId = String(checkpoint?.id || "").trim();
      const shouldDelete =
        (taskId && fileTaskId === taskId) ||
        (checkpointId && knownIds.has(checkpointId));
      if (shouldDelete) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      if (taskId && path.basename(filePath).toLowerCase().includes(taskId.toLowerCase())) {
        try {
          fs.unlinkSync(filePath);
        } catch (cleanupError) {
          // Ignore checkpoint cleanup failures for deleted tasks.
        }
      }
    }
  });
}

function isGitRepository(workspaceFolder) {
  const gitDir = path.join(workspaceFolder, ".git");
  return fs.existsSync(gitDir);
}

function createGitStash(workspaceFolder, taskId, toolName) {
  return new Promise((resolve) => {
    const stashLabel = `sarvam-${sanitizeCheckpointLabel(taskId)}-${sanitizeCheckpointLabel(toolName)}`;
    exec(`git stash push -m "${stashLabel}"`, { cwd: workspaceFolder }, (error) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve({ type: "git", stashLabel, toolName, taskId });
    });
  });
}

function getLatestGitStashId(workspaceFolder) {
  return new Promise((resolve) => {
    exec("git stash list --format=%i | head -1", { cwd: workspaceFolder }, (error, stdout) => {
      if (error || !stdout) {
        resolve(null);
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function restoreGitStash(workspaceFolder, stashId) {
  return new Promise((resolve) => {
    exec(`git stash pop ${stashId}`, { cwd: workspaceFolder }, (error) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

function pruneTaskAfterCheckpoint(workspaceFolder, task, checkpointId) {
  if (!task || !checkpointId) {
    return;
  }

  const history = Array.isArray(task.history) ? task.history : [];
  const checkpointIndexInHistory = history.findIndex((entry) => {
    const entryCheckpointId = String(entry?.checkpoint?.id || "").trim();
    return entryCheckpointId === String(checkpointId).trim();
  });
  if (checkpointIndexInHistory >= 0) {
    task.history = history.slice(0, checkpointIndexInHistory + 1);
  }

  const checkpoints = Array.isArray(task.checkpoints) ? task.checkpoints : [];
  const checkpointIndex = checkpoints.findIndex((item) => String(item?.id || "").trim() === String(checkpointId).trim());
  if (checkpointIndex > 0) {
    const newer = checkpoints.slice(0, checkpointIndex);
    newer.forEach((checkpoint) => {
      try {
        deleteCheckpointFile(workspaceFolder, checkpoint);
      } catch (error) {
        // Ignore cleanup failures while pruning newer checkpoints.
      }
    });
    task.checkpoints = checkpoints.slice(checkpointIndex);
  }
  task.followup = null;
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
    .filter((key) => !["tool_call", "arg_key", "arg_value", "raw"].includes(key))
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
  const rawPayload = String(toolCall.raw || "");
  const firstRawTag = (tag) => {
    if (!rawPayload) {
      return "";
    }
    const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = rawPayload.match(pattern);
    return match && match[1] ? String(match[1]).trim() : "";
  };
  const allRawTags = (tag) => {
    if (!rawPayload) {
      return [];
    }
    const pattern = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "gi");
    const values = [];
    let match;
    while ((match = pattern.exec(rawPayload))) {
      const value = match && match[1] ? String(match[1]).trim() : "";
      if (value) {
        values.push(value);
      }
    }
    return values;
  };
  const firstArg = (key) => {
    const direct = args[key] && args[key][0] ? String(args[key][0]).trim() : "";
    if (direct) {
      return direct;
    }
    return firstRawTag(key);
  };
  const pathArg = () => {
    const paths = (args.path || []).map((value) => String(value).trim()).filter(Boolean);
    if (!paths.length) {
      paths.push(...allRawTags("path"));
    }
    if (!paths.length) {
      return "";
    }
    return [...new Set(paths)].join(", ");
  };
  if (name === "read_file") {
    const paths = pathArg();
    return {
      title: "Read file",
      detail: paths || "(no path)"
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
    const lineRaw = firstArg("line");
    const lineValue = lineRaw ? `line ${lineRaw}` : "";
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
  if (name === "list_files") {
    const pathValue = pathArg() || ".";
    const recursiveValue = firstArg("recursive");
    return {
      title: "List files",
      detail: recursiveValue ? `${pathValue} | recursive: ${recursiveValue}` : pathValue
    };
  }
  if (name === "search_files") {
    const pathValue = pathArg() || ".";
    const regexValue = firstArg("regex");
    const filePatternValue = firstArg("file_pattern");
    const detailParts = [pathValue];
    if (regexValue) {
      detailParts.push(`regex: ${truncateText(regexValue, 80)}`);
    }
    if (filePatternValue) {
      detailParts.push(`pattern: ${filePatternValue}`);
    }
    return {
      title: "Search files",
      detail: detailParts.join(" | ")
    };
  }
  if (name === "list_code_definition_names") {
    return {
      title: "List code definitions",
      detail: pathArg() || firstArg("path") || "."
    };
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

function normalizeArgsForSignature(toolName, args) {
  if (!args || typeof args !== "object") {
    return {};
  }
  const normalizedToolName = String(toolName || "").trim().toLowerCase();
  const ignoredKeys = new Set(["raw"]);
  if (normalizedToolName === "write_to_file") {
    ignoredKeys.add("line_count");
  }
  const normalized = {};
  Object.keys(args)
    .filter((key) => !ignoredKeys.has(key))
    .sort()
    .forEach((key) => {
      const value = args[key];
      if (Array.isArray(value)) {
        normalized[key] = value.map((item) => String(item));
      } else if (value == null) {
        normalized[key] = "";
      } else {
        normalized[key] = String(value);
      }
    });
  return normalized;
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
  return String(result);
}

function extractAttemptCompletion(text) {
  if (!text) {
    return "";
  }
  const source = String(text);
  const decoded = source
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");

  const patterns = [
    /<attempt_completion\b[^>]*>[\s\S]*?<result\b[^>]*>([\s\S]*?)<\/result>[\s\S]*?<\/attempt_completion>/i,
    /<attempt_completion\b[^>]*>[\s\S]*?<result\b[^>]*>([\s\S]*?)<\/result>/i,
    /<attempt_completion\b[^>]*>([\s\S]*?)<\/attempt_completion>/i
  ];

  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match && match[1]) {
      const value = String(match[1]).trim();
      if (value) {
        return value;
      }
    }
  }

  // Streaming fallback: tolerate truncated XML where closing tags may be missing.
  const attemptStart = decoded.search(/<attempt_completion\b[^>]*>/i);
  if (attemptStart >= 0) {
    const afterAttempt = decoded.slice(attemptStart);
    const resultOpenMatch = afterAttempt.match(/<result\b[^>]*>/i);
    if (resultOpenMatch) {
      const resultStart = afterAttempt.indexOf(resultOpenMatch[0]) + resultOpenMatch[0].length;
      const tail = afterAttempt.slice(resultStart);
      const resultCloseIndex = tail.search(/<\/result>/i);
      const attemptCloseIndex = tail.search(/<\/attempt_completion>/i);
      let endIndex = tail.length;
      if (resultCloseIndex >= 0) {
        endIndex = resultCloseIndex;
      } else if (attemptCloseIndex >= 0) {
        endIndex = attemptCloseIndex;
      }
      const looseValue = tail.slice(0, endIndex).trim();
      if (looseValue) {
        return looseValue;
      }
    }
  }

  return "";
}

function countToolCallTags(text) {
  if (!text) {
    return 0;
  }
  // Count only executable/in-band tool tags. `title_name` is metadata and
  // should not block execution when emitted alongside a real tool call.
  const allowedToolNames = [
    "read_file",
    "write_to_file",
    "execute_command",
    "update_todo_list",
    "list_files",
    "search_files",
    "list_code_definition_names",
    "apply_diff",
    "insert_content",
    "search_and_replace",
    "fetch_instructions",
    "ask_followup_question",
    "new_task",
    "switch_mode"
  ];
  const escaped = allowedToolNames.map((name) => name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
  const regex = new RegExp(`<\\s*(?:${escaped.join("|")})\\b`, "gi");
  const matches = String(text).match(regex);
  return matches ? matches.length : 0;
}

function extractInlineTitleValue(text) {
  if (!text) {
    return "";
  }
  const source = String(text);
  const nestedMatch = source.match(/<title_name>[\s\S]*?<value>([\s\S]*?)<\/value>[\s\S]*?<\/title_name>/i);
  if (nestedMatch && nestedMatch[1]) {
    return String(nestedMatch[1]).trim();
  }
  const directMatch = source.match(/<title_name[^>]*>([\s\S]*?)<\/title_name>/i);
  if (!directMatch || !directMatch[1]) {
    return "";
  }
  const inner = String(directMatch[1]).trim();
  if (!inner || inner.startsWith("<")) {
    return "";
  }
  return inner;
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

function writeDiffBaselineFile(workspaceFolder, filePath, beforeText) {
  const previewRoot = path.join(workspaceFolder, ".sarvam", "preview");
  fs.mkdirSync(previewRoot, { recursive: true });
  const baseName = path.basename(filePath);
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const tempPath = path.join(previewRoot, `${baseName}.${stamp}.before`);
  fs.writeFileSync(tempPath, beforeText || "", "utf8");
  return tempPath;
}

async function showDiffPreview(filePath, beforeText, label) {
  const workspaceFolder = getWorkspaceFolder();
  const baselinePath = writeDiffBaselineFile(workspaceFolder, filePath, beforeText);
  const beforeUri = vscode.Uri.file(baselinePath);
  const afterUri = vscode.Uri.file(filePath);
  const title = label || `Changes: ${path.basename(filePath)}`;

  try {
    const afterDoc = await vscode.workspace.openTextDocument(afterUri);
    if (afterDoc.isDirty) {
      await afterDoc.save();
    }

    // Open the real file first as a permanent (non-preview) tab so it is
    // already sitting in the editor group. The diff overlay will display on
    // top; when the diff tab is closed the file tab is already there.
    await vscode.window.showTextDocument(afterDoc, {
      preview: false,
      preserveFocus: true,
      viewColumn: vscode.ViewColumn.Active
    });

    // Open the diff in preview-mode so it reuses the same tab slot without
    // creating an extra permanent tab.
    await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, title, { preview: true });

    // Close the diff tab after 2 s, then clean up the baseline file.
    scheduleDiffAutoClose(beforeUri, afterUri, 2000);
    setTimeout(() => {
      try {
        fs.unlinkSync(baselinePath);
      } catch (error) {
        // Ignore cleanup failures.
      }
    }, 2200);
  } catch (error) {
    // If diff preview fails, still open/save the edited file to avoid losing context.
    try {
      const afterDoc = await vscode.workspace.openTextDocument(afterUri);
      if (afterDoc.isDirty) {
        await afterDoc.save();
      }
      await vscode.window.showTextDocument(afterDoc, {
        preview: false,
        preserveFocus: false,
        viewColumn: vscode.ViewColumn.Active
      });
    } catch (openError) {
      // Ignore fallback open failures.
    }
    try {
      fs.unlinkSync(baselinePath);
    } catch (cleanupError) {
      // Ignore cleanup failures.
    }
  }
}

const commandSessionStore = {
  sessions: new Map(),
  terminalToSession: new Map(),
  dataListener: null,
  closeListener: null,
  counter: 0
};

function resolvePreferredShell(shellPath) {
  if (shellPath) {
    return shellPath;
  }
  if (vscode.env.shell) {
    return vscode.env.shell;
  }
  return process.platform === "win32" ? "powershell.exe" : "/bin/bash";
}

function appendSessionTranscript(session, chunk) {
  session.transcript += chunk;
  session.lastUpdatedAt = new Date().toISOString();
  const maxChars = 200000;
  if (session.transcript.length > maxChars) {
    session.transcript = session.transcript.slice(session.transcript.length - maxChars);
  }
}

function sanitizeTerminalOutput(value) {
  if (!value) {
    return "";
  }
  const source = String(value);
  const cleaned = source
    // OSC sequences (e.g. VS Code shell integration: ESC ] ... BEL / ST)
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "")
    // CSI sequences (colors, cursor controls)
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    // Other single-character ESC sequences
    .replace(/\x1B[@-Z\\-_]/g, "");
  // Remove VS Code shell integration markers/prompts that may appear as plain text
  const filteredLines = cleaned
    .split(/\r?\n/)
    .filter((line) => {
      const text = String(line || "").trim();
      if (!text) {
        return true;
      }
      if (/__SARVAM_/i.test(text)) {
        return false;
      }
      if (/\]633;|Cwd=|Write-Output\s+"__SARVAM_/i.test(text)) {
        return false;
      }
      if (/^PS\s+.*>\s*(?:$|java\s+-version|javac\s+-version|echo\s+"---")/i.test(text)) {
        return false;
      }
      return true;
    });
  return filteredLines.join("\n");
}

function tailSessionTranscript(session, maxChars = 6000) {
  if (!session || !session.transcript) {
    return "(no output yet)";
  }
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 6000;
  const cleaned = sanitizeTerminalOutput(session.transcript);
  return cleaned.length > limit
    ? `...\n${cleaned.slice(cleaned.length - limit)}`
    : cleaned;
}

function buildShellEchoCommand(shellName, markerText) {
  const safe = String(markerText || "").replace(/\"/g, '\\\"');
  if (shellName.includes("powershell") || shellName.includes("pwsh")) {
    return `Write-Output \"${safe}\"`;
  }
  return `echo ${markerText}`;
}

function ensureCommandSessionListeners() {
  if (!commandSessionStore.dataListener) {
    commandSessionStore.dataListener = vscode.window.onDidWriteTerminalData((event) => {
      const sessionId = commandSessionStore.terminalToSession.get(event.terminal);
      if (!sessionId) {
        return;
      }
      const session = commandSessionStore.sessions.get(sessionId);
      if (!session) {
        return;
      }
      const chunk = String(event.data || "");
      appendSessionTranscript(session, chunk);
      if (!session.pending) {
        return;
      }
      session.pending.collected += chunk;
      if (!session.pending.collected.includes(session.pending.endMarker)) {
        return;
      }

      const collected = session.pending.collected;
      const startIndex = collected.indexOf(session.pending.startMarker);
      const endIndex = collected.indexOf(session.pending.endMarker);
      const extracted = startIndex >= 0 && endIndex > startIndex
        ? collected.slice(startIndex + session.pending.startMarker.length, endIndex)
        : collected;
      const resultText = extracted
        .replace(session.pending.startMarker, "")
        .replace(session.pending.endMarker, "")
        .trim();

      const resolver = session.pending.resolve;
      if (session.pending.timeoutHandle) {
        clearTimeout(session.pending.timeoutHandle);
      }
      session.pending = null;
      resolver({
        status: "completed",
        output: resultText || "(no output)",
        sessionId: session.id
      });
    });
  }

  if (!commandSessionStore.closeListener) {
    commandSessionStore.closeListener = vscode.window.onDidCloseTerminal((closed) => {
      const sessionId = commandSessionStore.terminalToSession.get(closed);
      if (!sessionId) {
        return;
      }
      const session = commandSessionStore.sessions.get(sessionId);
      if (session && session.pending) {
        const resolver = session.pending.resolve;
        if (session.pending.timeoutHandle) {
          clearTimeout(session.pending.timeoutHandle);
        }
        session.pending = null;
        resolver({
          status: "closed",
          output: "Terminal was closed before command completion.",
          sessionId: session.id
        });
      }
      commandSessionStore.terminalToSession.delete(closed);
      commandSessionStore.sessions.delete(sessionId);
    });
  }
}

function createCommandSession({ shellPath, cwd }) {
  ensureCommandSessionListeners();
  const resolvedShell = resolvePreferredShell(shellPath);
  commandSessionStore.counter += 1;
  const id = `s${Date.now().toString(36)}${commandSessionStore.counter.toString(36)}`;
  const options = {
    name: `Sarvam: Shell ${id}`,
    cwd: cwd || undefined
  };
  if (resolvedShell) {
    options.shellPath = resolvedShell;
  }
  const terminal = vscode.window.createTerminal(options);
  const session = {
    id,
    terminal,
    shellPath: resolvedShell,
    cwd: cwd || "",
    transcript: "",
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    running: Promise.resolve(),
    pending: null,
    lastCommand: ""
  };
  commandSessionStore.sessions.set(id, session);
  commandSessionStore.terminalToSession.set(terminal, id);
  return session;
}

function getCommandSession(sessionId) {
  if (!sessionId) {
    return null;
  }
  return commandSessionStore.sessions.get(String(sessionId).trim()) || null;
}

function closeCommandSession(sessionId) {
  const session = getCommandSession(sessionId);
  if (!session) {
    return { ok: false, message: `No active shell session found for '${sessionId}'.` };
  }
  const output = tailSessionTranscript(session, 8000);
  commandSessionStore.sessions.delete(session.id);
  commandSessionStore.terminalToSession.delete(session.terminal);
  session.terminal.dispose();
  return {
    ok: true,
    message: `Closed shell session ${session.id}.`,
    output,
    sessionId: session.id
  };
}

function runExecuteCommandInTerminal({ command, shellPath, cwd, sessionId, waitForCompletion = true, timeoutMs = 15000, revealTerminal = true }) {
  const activeSession = getCommandSession(sessionId) || createCommandSession({ shellPath, cwd });
  if (cwd && activeSession.cwd !== cwd) {
    const shellName = String(activeSession.shellPath || "").toLowerCase();
    const cdCommand = buildShellCdCommand(shellName, cwd);
    if (cdCommand) {
      activeSession.terminal.sendText(cdCommand, true);
    }
    activeSession.cwd = cwd;
  }

  if (revealTerminal) {
    activeSession.terminal.show(true);
  }

  const normalizedCommand = normalizeShellCommand(command, activeSession.shellPath);
  const shellName = String(activeSession.shellPath || "").toLowerCase();
  activeSession.lastCommand = normalizedCommand;

  activeSession.running = activeSession.running.then(() => new Promise((resolve) => {
    if (!waitForCompletion) {
      activeSession.terminal.sendText(normalizedCommand, true);
      resolve({
        status: "running",
        output: "Command started in interactive shell.",
        sessionId: activeSession.id
      });
      return;
    }

    const marker = `__SARVAM_${Date.now()}_${Math.random().toString(16).slice(2, 7)}__`;
    const startMarker = `${marker}_START`;
    const endMarker = `${marker}_END`;
    const pending = {
      startMarker,
      endMarker,
      resolve,
      collected: "",
      timeoutHandle: null
    };

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      pending.timeoutHandle = setTimeout(() => {
        if (!activeSession.pending || activeSession.pending !== pending) {
          return;
        }
        activeSession.pending = null;
        resolve({
          status: "running",
          output: tailSessionTranscript(activeSession, 4000),
          sessionId: activeSession.id
        });
      }, timeoutMs);
    }

    activeSession.pending = pending;
    activeSession.terminal.sendText(buildShellEchoCommand(shellName, startMarker), true);
    activeSession.terminal.sendText(normalizedCommand, true);
    activeSession.terminal.sendText(buildShellEchoCommand(shellName, endMarker), true);
  }));

  return activeSession.running.then((result) => ({
    ...result,
    shellPath: activeSession.shellPath,
    cwd: activeSession.cwd || cwd || "",
    command: normalizedCommand
  }));
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

function parseBooleanArg(args, key, defaultValue = false) {
  if (!args || !Array.isArray(args[key]) || !args[key].length) {
    return defaultValue;
  }
  const raw = String(args[key][0]).trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (["true", "1", "yes", "y", "on"].includes(raw)) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(raw)) {
    return false;
  }
  return defaultValue;
}

function parseNumberArg(args, key, defaultValue) {
  if (!args || !Array.isArray(args[key]) || !args[key].length) {
    return defaultValue;
  }
  const parsed = Number(String(args[key][0]).trim());
  return Number.isFinite(parsed) ? parsed : defaultValue;
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
            command: { type: "string", description: "Command to run." },
            cwd: { type: "string", description: "Optional working directory (if allowed by settings)." },
            session_id: { type: "string", description: "Optional shell session id to reuse." },
            wait_for_completion: { type: "boolean", description: "Wait until command completes. If false, return immediately and keep session interactive." },
            timeout_ms: { type: "number", description: "Max wait time when wait_for_completion is true. If exceeded, returns current output and keeps command/session running." },
            reveal_terminal: { type: "boolean", description: "Bring terminal to foreground while running command." },
            read_output: { type: "boolean", description: "If true, ignore command and read the latest output from session_id." },
            close_session: { type: "boolean", description: "If true, close session_id and return final transcript tail." }
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
  const root = getCheckpointRoot(workspaceFolder);
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs
    .readdirSync(root)
    .filter((file) => file.toLowerCase().endsWith(".json"))
    .map((file) => path.join(root, file));
}

function readCheckpointFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function resolveAutoApprove(toolName, autoApprove) {
  const normalizedToolName = String(toolName || "").trim().toLowerCase();
  const alwaysApprovedTools = new Set(["list_files", "list_code_definition_names", "search_files"]);
  if (alwaysApprovedTools.has(normalizedToolName)) {
    return true;
  }
  const readTools = new Set(["read_file"]);
  const writeTools = new Set(["write_to_file", "apply_diff", "search_and_replace", "insert_content"]);
  if (readTools.has(normalizedToolName)) {
    return Boolean(autoApprove && autoApprove.read);
  }
  if (writeTools.has(normalizedToolName)) {
    return Boolean(autoApprove && autoApprove.write);
  }
  if (normalizedToolName === "execute_command") {
    return Boolean(autoApprove && autoApprove.execute);
  }
  return true;
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
    this.abortController = null;
    this.stopRequested = false;
    this.webview = null;
    this.settings = null;
    this.autoApprove = getDefaultAutoApproveConfig();
    this.taskShellSessions = new Map();
  }

  async generateTaskTitleFromHistory({ settings, activeTask, send, workspaceFolder, requestId, logEvent }) {
    if (!settings || !activeTask) {
      return;
    }
    const titlePrompt = "You have the complete message history after attempt_completion tool is invoked. Can you provide a title using title_name tool? Respond with exactly one valid tool call: <title_name><value>...</value></title_name>. Use a concise 3-7 word title. No prose.";
    const titleMessages = [
      ...buildModelMessages(this.systemPrompt, this.history),
      { role: "system", content: titlePrompt }
    ];
    const titlePayloadSummary = {
      model: settings.model,
      messageCount: titleMessages.length,
      messages: summarizeMessages(titleMessages, 6)
    };
    const rawTitleRequest = JSON.stringify({ model: settings.model, messages: titleMessages }, null, 2);
    logEvent({
      level: "info",
      phase: "response",
      message: "Title request payload",
      detail: truncateText(JSON.stringify(titlePayloadSummary), 900),
      rawRequest: rawTitleRequest,
      taskId: this.currentTaskId,
      requestId
    });
    let titleResponse = "";
    try {
      const titleResult = await streamChatCompletions({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: titleMessages,
        signal: null,
        onDelta: (delta) => {
          titleResponse += delta;
        }
      });
      if (titleResult && typeof titleResult.assistantText === "string") {
        titleResponse = titleResult.assistantText;
      }
      logEvent({
        level: "info",
        phase: "response",
        message: "Title response received",
        rawResponse: titleResponse || "",
        finalResponse: stripToolXml(titleResponse || ""),
        taskId: this.currentTaskId,
        requestId
      });
    } catch (error) {
      logEvent({
        level: "warn",
        phase: "response",
        message: "Skipped auto title update",
        detail: error && error.message ? error.message : "Title generation failed",
        taskId: this.currentTaskId,
        requestId
      });
      return;
    }

    const titleCall = extractToolCall(titleResponse || "");
    let titleValue = "";
    if (titleCall && titleCall.name === "title_name") {
      titleValue = (
        (titleCall.args.value && titleCall.args.value[0]) ||
        (titleCall.args.title && titleCall.args.title[0]) ||
        (titleCall.args.name && titleCall.args.name[0]) ||
        ""
      );
    }
    if (!titleValue) {
      const titleMatch = String(titleResponse || "").match(/<title_name>[\s\S]*?<value>([\s\S]*?)<\/value>[\s\S]*?<\/title_name>/i);
      if (titleMatch && titleMatch[1]) {
        titleValue = titleMatch[1];
      }
    }
    if (!titleValue) {
      const looseValueMatch = String(titleResponse || "").match(/<value>([\s\S]*?)<\/value>/i);
      if (looseValueMatch && looseValueMatch[1]) {
        titleValue = looseValueMatch[1];
      }
    }
    if (!titleValue) {
      // Fallback: model emitted <title_name>TEXT</title_name> without a <value> wrapper
      const directContentMatch = String(titleResponse || "").match(/<title_name[^>]*>([\s\S]*?)<\/title_name>/i);
      if (directContentMatch && directContentMatch[1]) {
        const inner = directContentMatch[1].trim();
        // Only use if it doesn't look like more XML (i.e., not a nested tag block)
        if (inner && !inner.startsWith("<")) {
          titleValue = inner;
        }
      }
    }
    if (!titleValue) {
      // Fallback: accept plain text response and derive a concise title.
      titleValue = stripToolXml(String(titleResponse || ""))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || "";
    }

    const normalizedTitle = String(titleValue || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    const compactTitle = normalizedTitle
      .split(" ")
      .slice(0, 7)
      .join(" ")
      .trim();

    const finalTitle = compactTitle || normalizedTitle;

    if (!finalTitle || finalTitle === activeTask.title) {
      logEvent({
        level: "info",
        phase: "response",
        message: "Task title unchanged",
        detail: "Title generation returned empty or same title",
        taskId: this.currentTaskId,
        requestId
      });
      return;
    }

    activeTask.title = finalTitle;
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
    logEvent({
      level: "info",
      phase: "response",
      message: "Task title updated",
      detail: finalTitle,
      taskId: this.currentTaskId,
      requestId
    });
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
        checkpoints: Array.isArray(task.checkpoints) ? task.checkpoints : [],
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
    this.autoApprove = getDefaultAutoApproveConfig();

    webviewView.webview.postMessage({
      type: "autoApprove",
      value: this.autoApprove
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
          this.autoApprove = getDefaultAutoApproveConfig();
          send({ type: "autoApprove", value: this.autoApprove });
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
      this.lastToolDecision = null;
      this.pendingFollowupChoice = null;
      this.lastFollowupChoice = null;

      const settings = this.settings || defaults;
      if (!settings || !settings.baseUrl || !settings.apiKey || !settings.model || !settings.contextWindow) {
        send({ type: "error", value: "Provider settings are incomplete." });
        return;
      }

      this.processing = true;
  this.stopRequested = false;
      const requestId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      try {
        send({ type: "requestState", value: { running: true } });
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
        let noToolRetryStage = 0;
        let repeatedWritePath = "";
        let repeatedWriteCount = 0;
        let didMutatingToolRun = false;
        let didApplyDiffRun = false;
        let didAnyToolRun = false;
        const explicitApplyDiffRequested = (() => {
          const raw = String(userContent || "");
          if (!/\bapply_diff\b/i.test(raw)) return false;
          // Exclude when apply_diff is mentioned only in a negation context (e.g. "do not use apply_diff")
          if (/\b(?:not|don'?t|no|without|avoid)\b[^.!?]*\bapply_diff\b/i.test(raw)) return false;
          return true;
        })();
        const explicitEditRequested = /\b(update|modify|remove|replace|insert|edit|change|rewrite|fix)\b/i.test(String(userContent || ""));
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
            signal: (this.abortController = new AbortController()).signal,
            onDelta: (delta) => {
              assistantText += delta;
              send({ type: "assistantDelta", value: delta });
            }
          });
          this.abortController = null;
          assistantText = result.assistantText;
          usage = result.usage;
          const responseDetail = usage
            ? `Tokens in/out: ${usage.prompt_tokens ?? "?"}/${usage.completion_tokens ?? "?"}`
            : "";
          const rawSnippet = result.rawResponse || assistantText || "";
          const displaySnippet = stripToolXml(assistantText);
          const thinkingSnippet = (() => {
            const m = String(assistantText || "").match(/<thinking>([\s\S]*?)<\/thinking>/i);
            return m ? String(m[1]).trim() : "";
          })();
          const logFinalResponse = thinkingSnippet
            ? `[Thinking]\n${thinkingSnippet}\n\n[Response]\n${displaySnippet}`
            : displaySnippet;
          logEvent({
            level: "info",
            phase: "response",
            message: "Model response received",
            detail: responseDetail,
            rawResponse: rawSnippet,
            finalResponse: logFinalResponse,
            taskId: this.currentTaskId,
            requestId
          });
        } catch (error) {
          this.abortController = null;
          if (error && error.name === "AbortError") {
            if (assistantText && assistantText.trim()) {
              const partial = stripToolXml(assistantText);
              if (partial) {
                const assistantMessage = createHistoryEntry("assistant", partial, assistantText, partial);
                this.history.push(assistantMessage);
                if (activeTask) {
                  activeTask.history = this.history;
                }
                saveSarvamState(workspaceFolder, {
                  settings: this.settings,
                  tasks: this.tasks,
                  currentTaskId: this.currentTaskId
                });
                send({ type: "assistantDone", value: { text: partial, raw: assistantText } });
              }
            }
            const notice = this.stopRequested ? "Request stopped by user." : "Request aborted.";
            if (!this.stopRequested) {
              send({ type: "error", value: notice });
            }
            logEvent({ level: "warn", phase: "response", message: notice, taskId: this.currentTaskId, requestId });
            break;
          }
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
        const inlineTitleValue = extractInlineTitleValue(assistantText);
        const assistantTextWithoutTitle = String(assistantText || "").replace(/<title_name>[\s\S]*?<\/title_name>/gi, " ");
        const toolCall = extractToolCall(assistantTextWithoutTitle);
        const toolCallCount = countToolCallTags(assistantText);
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
        if (inlineTitleValue && activeTask) {
          const normalizedTitle = String(inlineTitleValue)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80);
          if (normalizedTitle && normalizedTitle !== activeTask.title) {
            activeTask.title = normalizedTitle;
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

        if (completionText) {
          if (explicitApplyDiffRequested && !didApplyDiffRun) {
            const promptMessage = "The user explicitly requested apply_diff. You must execute exactly one valid <apply_diff> tool call before final completion.";
            logEvent({
              level: "warn",
              phase: "response",
              message: "Blocked completion before apply_diff",
              detail: "Completion attempted without apply_diff execution",
              taskId: this.currentTaskId,
              requestId
            });
            messages = [...buildModelMessages(this.systemPrompt, this.history), { role: "system", content: promptMessage }];
            loopGuard = 0;
            continue;
          }
          if (explicitEditRequested && !didMutatingToolRun) {
            const promptMessage = "The user requested a file edit. Execute exactly one valid mutating tool call (apply_diff, write_to_file, search_and_replace, or insert_content) before final completion.";
            logEvent({
              level: "warn",
              phase: "response",
              message: "Blocked completion before edit tool",
              detail: "Completion attempted without mutating tool execution",
              taskId: this.currentTaskId,
              requestId
            });
            messages = [...buildModelMessages(this.systemPrompt, this.history), { role: "system", content: promptMessage }];
            loopGuard = 0;
            continue;
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
          send({ type: "assistantDone", value: { text: completionText, raw: assistantText } });
          await this.generateTaskTitleFromHistory({
            settings,
            activeTask,
            send,
            workspaceFolder,
            requestId,
            logEvent
          });
          finalDelivered = true;
          break;
        }

        if (toolCallCount > 1) {
          logEvent({
            level: "warn",
            phase: "response",
            message: "Model returned multiple tool calls in one response",
            detail: `Detected ${toolCallCount} tool tags; requesting exactly one tool call`,
            taskId: this.currentTaskId,
            requestId
          });
          const multiToolPrompt = "You returned multiple tool calls in one message. Respond with exactly one valid tool call and no prose.";
          messages = [...buildModelMessages(this.systemPrompt, this.history), { role: "system", content: multiToolPrompt }];
          loopGuard = 0;
          continue;
        }

        if (!toolCall) {
          const shouldRecordNoToolResponse = finalAttempted;
          if (displayText && shouldRecordNoToolResponse) {
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
          }

          if (didAnyToolRun && !finalAttempted) {
            finalAttempted = true;
            const promptMessage = "You already executed the required tool(s). Provide the final response now using <attempt_completion><result>...</result></attempt_completion>. Do not call any more tools and do not include prose outside attempt_completion.";
            logEvent({
              level: "info",
              phase: "response",
              message: "Requesting attempt_completion after tool execution",
              detail: truncateText(displayText || "(empty response)", 240),
              taskId: this.currentTaskId,
              requestId
            });
            messages = [...buildModelMessages(this.systemPrompt, this.history), { role: "system", content: promptMessage }];
            loopGuard = 0;
            continue;
          }

          if (noToolRetryStage === 0) {
            const promptMessage = "You responded with no tools. Review the system prompt and conversation history, then respond with exactly one valid tool call and no prose.";
            logEvent({
              level: "warn",
              phase: "response",
              message: "Model responded with no tool",
              detail: promptMessage,
              taskId: this.currentTaskId,
              requestId
            });
            const retryMessages = buildModelMessages(this.systemPrompt, this.history);
            messages = [...retryMessages, { role: "system", content: promptMessage }];
            noToolRetryStage = 1;
            loopGuard = 0;
            continue;
          }

          if (!finalAttempted) {
            finalAttempted = true;
            const completionPrompt = "You have enough context. Respond now with exactly one <attempt_completion><result>...</result></attempt_completion> and no tool calls.";
            logEvent({
              level: "warn",
              phase: "response",
              message: "Model responded with no tool after retries",
              detail: "Requesting forced attempt_completion",
              taskId: this.currentTaskId,
              requestId
            });
            messages = [...buildModelMessages(this.systemPrompt, this.history), { role: "system", content: completionPrompt }];
            loopGuard = 0;
            continue;
          }

          const stopMessage = "[System Message] Model responded with no tools after retries and forced completion. Stopping.";
          logEvent({
            level: "warn",
            phase: "response",
            message: "Model responded with no tool after forced completion",
            taskId: this.currentTaskId,
            requestId
          });
          this.history.push(createHistoryEntry("tool-execution", stopMessage, stopMessage, stopMessage));
          if (activeTask) {
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
              content: stopMessage,
              raw: stopMessage
            }
          });
          break;
        }
        noToolRetryStage = 0;
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

        const mutatingTools = new Set(["write_to_file", "apply_diff", "search_and_replace", "insert_content"]);
        if (mutatingTools.has(toolCall.name)) {
          didMutatingToolRun = true;
        }
        if (toolCall.name === "apply_diff") {
          didApplyDiffRun = true;
        }

        if (toolCall.name === "write_to_file") {
          const currentWritePath = String((toolCall.args.path && toolCall.args.path[0]) || "").trim().toLowerCase();
          if (currentWritePath && currentWritePath === repeatedWritePath) {
            repeatedWriteCount += 1;
          } else {
            repeatedWritePath = currentWritePath;
            repeatedWriteCount = 0;
          }
          if (repeatedWriteCount >= 1) {
            const writeLoopNotice = `Detected repeated write_to_file calls on '${currentWritePath || "(unknown path)"}'.`;
            logEvent({
              level: "warn",
              phase: "response",
              message: "Repeated write_to_file detected",
              detail: writeLoopNotice,
              taskId: this.currentTaskId,
              requestId
            });
            if (!finalAttempted) {
              finalAttempted = true;
              const finalPrompt = "You already updated this file multiple times. Stop calling write tools and provide the final response now using <attempt_completion>.";
              messages = [...buildModelMessages(this.systemPrompt, this.history), { role: "system", content: finalPrompt }];
              loopGuard = 0;
              continue;
            }
            send({ type: "error", value: writeLoopNotice });
            break;
          }
        } else {
          repeatedWritePath = "";
          repeatedWriteCount = 0;
        }

        const signatureArgs = normalizeArgsForSignature(toolCall.name, toolCall.args || {});
        const toolSignature = `${toolCall.name}:${JSON.stringify(signatureArgs)}`;
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

        const shouldAutoApprove = resolveAutoApprove(toolCall.name, this.autoApprove);
        if (!shouldAutoApprove) {
          // Reset any stale buffered decision before showing a new approval prompt.
          this.lastToolDecision = null;
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
            if (this.lastToolDecision) {
              const value = this.lastToolDecision;
              this.lastToolDecision = null;
              resolve(value);
            }
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
        let checkpointRecord = null;
        const normalizedToolName = String(toolCall.name || "").trim().toLowerCase();
        if (normalizedToolName === "title_name") {
          const titleValue =
            (toolCall.args.value && toolCall.args.value[0]) ||
            (toolCall.args.title && toolCall.args.title[0]) ||
            (toolCall.args.name && toolCall.args.name[0]) ||
            inlineTitleValue ||
            "";
          const normalizedTitle = String(titleValue)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80);
          if (activeTask && normalizedTitle && normalizedTitle !== activeTask.title) {
            activeTask.title = normalizedTitle;
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
          continue;
        }
        if (normalizedToolName === "attempt_completion") {
          // Model emitted attempt_completion as a tool call instead of using the
          // <attempt_completion> wrapper. Extract the result text and deliver it.
          const resultText = (toolCall.args.result && toolCall.args.result[0]) ||
            (toolCall.args.content && toolCall.args.content[0]) ||
            displayText ||
            "";
          this.history.push(assistantMessage);
          if (activeTask) {
            activeTask.history = this.history;
          }
          saveSarvamState(workspaceFolder, {
            settings: this.settings,
            tasks: this.tasks,
            currentTaskId: this.currentTaskId
          });
          send({ type: "assistantDone", value: { text: resultText || displayText, raw: assistantText } });
          finalDelivered = true;
          break;
        }
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
          const executeCommandValue = String((toolCall.args.command && toolCall.args.command[0]) || "").trim();
          const executeReadOutput = parseBooleanArg(toolCall.args, "read_output", false);
          const executeCloseSession = parseBooleanArg(toolCall.args, "close_session", false);
          const executeWillRunCommand = normalizedToolName === "execute_command"
            && !executeReadOutput
            && !executeCloseSession
            && Boolean(executeCommandValue);
          let shouldPreviewDiff = writeTools.has(normalizedToolName) || executeWillRunCommand;
          let previewPath = "";
          let beforeSnapshot = "";
          if (normalizedToolName === "write_to_file") {
            previewPath = String((toolCall.args.path && toolCall.args.path[0]) || "").trim();
            if (previewPath) {
              const absolutePath = ensureWorkspacePath(getWorkspaceFolder(), previewPath);
              beforeSnapshot = readFileSafe(absolutePath);
              preWriteExists = fs.existsSync(absolutePath);
              const nextContent = String((toolCall.args.content && toolCall.args.content[0]) || "");
              if (beforeSnapshot === nextContent) {
                shouldPreviewDiff = false;
              }
            }
          }
          if (shouldPreviewDiff) {
            if (normalizedToolName === "execute_command") {
              // For execute_command, create git stash if in git repo
              if (isGitRepository(getWorkspaceFolder())) {
                const gitStash = await createGitStash(getWorkspaceFolder(), this.currentTaskId, toolCall.name);
                if (gitStash && gitStash.stashLabel) {
                  const stashId = await getLatestGitStashId(getWorkspaceFolder());
                  checkpointRecord = createRestoreCheckpoint(getWorkspaceFolder(), {
                    taskId: this.currentTaskId,
                    toolName: toolCall.name,
                    checkpointType: "git",
                    gitStashId: stashId,
                    toolCall: toolCall.raw,
                    files: []
                  });
                }
              }
              // If not in git repo or git stash failed, fall back to full workspace snapshot
              if (!checkpointRecord) {
                const workspaceFiles = [];
                const root = getWorkspaceFolder();
                const ignorePatterns = [".git", ".sarvam", "node_modules", "dist", "build", ".next", ".venv", "venv"];
                const shouldIgnore = (filePath) => {
                  const relative = path.relative(root, filePath).split(path.sep);
                  return relative.some((part) => ignorePatterns.includes(part));
                };
                const walkFiles = (dir) => {
                  if (!fs.existsSync(dir)) return;
                  try {
                    const entries = fs.readdirSync(dir);
                    entries.forEach((entry) => {
                      const fullPath = path.join(dir, entry);
                      if (shouldIgnore(fullPath)) return;
                      try {
                        const stat = fs.statSync(fullPath);
                        if (stat.isFile() && stat.size < 5 * 1024 * 1024) {
                          const content = fs.readFileSync(fullPath, "utf8");
                          workspaceFiles.push({
                            path: path.relative(root, fullPath),
                            existedBefore: true,
                            content
                          });
                        } else if (stat.isDirectory()) {
                          walkFiles(fullPath);
                        }
                      } catch (error) {
                        // Skip unreadable files
                      }
                    });
                  } catch (error) {
                    // Skip unreadable directories
                  }
                };
                walkFiles(root);
                checkpointRecord = createRestoreCheckpoint(getWorkspaceFolder(), {
                  taskId: this.currentTaskId,
                  toolName: toolCall.name,
                  checkpointType: "snapshot",
                  toolCall: toolCall.raw,
                  files: workspaceFiles
                });
              }
            } else {
              // For write tools, snapshot specific file
              previewPath = String((toolCall.args.path && toolCall.args.path[0]) || "").trim();
              if (!previewPath && toolCall.raw) {
                const pathMatch = String(toolCall.raw).match(/<path>([\s\S]*?)<\/path>/i);
                previewPath = pathMatch && pathMatch[1] ? String(pathMatch[1]).trim() : "";
              }
              if (previewPath) {
                const absolutePath = ensureWorkspacePath(getWorkspaceFolder(), previewPath);
                beforeSnapshot = readFileSafe(absolutePath);
                preWriteExists = fs.existsSync(absolutePath);
                checkpointRecord = createRestoreCheckpoint(getWorkspaceFolder(), {
                  taskId: this.currentTaskId,
                  toolName: toolCall.name,
                  targetPath: previewPath,
                  toolCall: toolCall.raw,
                  files: [{
                    path: previewPath,
                    existedBefore: preWriteExists,
                    content: preWriteExists ? beforeSnapshot : ""
                  }]
                });
              }
            }
            if (checkpointRecord) {
              if (activeTask) {
                if (!Array.isArray(activeTask.checkpoints)) {
                  activeTask.checkpoints = [];
                }
                activeTask.checkpoints.unshift(checkpointRecord);
              }
              const checkpointDisplay = "Checkpoint created";
              this.history.push(createHistoryEntry("tool-execution", checkpointDisplay, checkpointDisplay, checkpointDisplay, { checkpoint: checkpointRecord }));
              if (activeTask && this.history.length > 0) {
                activeTask.history = this.history;
              }
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
              send({
                type: "historyAppend",
                value: {
                  role: "tool-execution",
                  content: checkpointDisplay,
                  raw: checkpointDisplay,
                  checkpoint: checkpointRecord
                }
              });
            }
          }
          if (normalizedToolName === "execute_command") {
            const commandValue = (toolCall.args.command && toolCall.args.command[0]) || "";
            const cwdValue = toolCall.args.cwd && toolCall.args.cwd[0] ? toolCall.args.cwd[0] : "";
            const modelSessionId = toolCall.args.session_id && toolCall.args.session_id[0] ? String(toolCall.args.session_id[0]).trim() : "";
            // Use task-scoped session when model doesn't specify one
            const sessionIdValue = modelSessionId || (this.currentTaskId ? (this.taskShellSessions.get(this.currentTaskId) || "") : "");
            const readOutput = parseBooleanArg(toolCall.args, "read_output", false);
            const closeSession = parseBooleanArg(toolCall.args, "close_session", false);
            const waitForCompletion = parseBooleanArg(toolCall.args, "wait_for_completion", true);
            const timeoutMs = parseNumberArg(toolCall.args, "timeout_ms", 15000);
            const revealTerminal = parseBooleanArg(toolCall.args, "reveal_terminal", true);
            const config = vscode.workspace.getConfiguration("sarvamCoder");
            const captureMode = config.get("execute.captureMode", "terminal");

            if (readOutput) {
              if (!sessionIdValue) {
                toolResult = "Missing session_id for read_output=true.";
              } else {
                const session = getCommandSession(sessionIdValue);
                if (!session) {
                  toolResult = `No active shell session found for '${sessionIdValue}'.`;
                } else {
                  toolResult = `Shell session ${session.id} output (latest):\n${tailSessionTranscript(session, 8000)}`;
                }
              }
            } else if (closeSession) {
              if (!sessionIdValue) {
                toolResult = "Missing session_id for close_session=true.";
              } else {
                const closed = closeCommandSession(sessionIdValue);
                if (!closed.ok) {
                  toolResult = closed.message;
                } else {
                  toolResult = `${closed.message}\nFinal output:\n${closed.output || "(no output)"}`;
                }
              }
            } else if (!commandValue) {
              toolResult = "No command provided.";
            } else {
              const workspaceFolder = getWorkspaceFolder();
              const allowCwdOverride = config.get("execute.allowCwdOverride", false);
              const commandCwd = allowCwdOverride ? resolveCommandCwd(workspaceFolder, cwdValue) : workspaceFolder;

              if (captureMode === "terminal") {
                const shellResult = await runExecuteCommandInTerminal({
                  command: commandValue,
                  shellPath: vscode.env.shell,
                  cwd: commandCwd,
                  sessionId: sessionIdValue,
                  waitForCompletion,
                  timeoutMs,
                  revealTerminal
                });
                // Remember the session for this task so subsequent commands reuse it
                if (this.currentTaskId && shellResult.sessionId) {
                  this.taskShellSessions.set(this.currentTaskId, shellResult.sessionId);
                }
                const lines = [
                  `Shell session: ${shellResult.sessionId}`,
                  `Working directory: ${shellResult.cwd || commandCwd}`,
                  `Command: ${shellResult.command || commandValue}`,
                  `Status: ${shellResult.status}`,
                  `Output:`,
                  shellResult.output || "(no output)"
                ];
                toolResult = lines.join("\n");
              } else {
                const showTerminal = config.get("execute.showTerminalOnProcess", false);
                if (showTerminal) {
                  const quickSession = createCommandSession({ shellPath: vscode.env.shell, cwd: commandCwd });
                  quickSession.terminal.show(true);
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
              void showDiffPreview(absolutePath, beforeSnapshot, `Changes: ${previewPath}`);
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
        didAnyToolRun = true;

        send({ type: "toolRequestClear" });
        if (normalizedToolName === "update_todo_list") {
          send({ type: "todoList", value: parseTodoArgs(toolCall.args) });
        }
        const safeToolResult = escapeToolResultForModel(toolResult);
        const toolSummary = formatToolResultSummary(toolCall, { preWriteExists });
        const summaryText = toolSummary ? ` ${toolSummary}` : "";
        const displayToolResult = `Tool result (${toolCall.name}):${summaryText}\n${toolResult}`;
        const modelToolResult = `Tool result (${toolCall.name}):\n${typeof safeToolResult === 'string' ? safeToolResult : String(safeToolResult)}`;
        this.history.push(createHistoryEntry("tool-execution", displayToolResult, displayToolResult, modelToolResult, { checkpoint: checkpointRecord }));
        if (activeTask && this.history.length > 0) {
          activeTask.history = this.history;
        }
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
        send({
          type: "historyAppend",
          value: {
            role: "tool-execution",
            content: displayToolResult,
            raw: displayToolResult,
            checkpoint: checkpointRecord
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
      } finally {
        this.abortController = null;
        this.stopRequested = false;
        this.processing = false;
        send({ type: "requestState", value: { running: false } });
        logEvent({
          level: "info",
          phase: "response",
          message: "Request finished",
          taskId: this.currentTaskId,
          requestId
        });
      }
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

      if (message.type === "autoApproveUpdate") {
        this.autoApprove = normalizeAutoApproveConfig(message.value);
        send({ type: "autoApprove", value: this.autoApprove });
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

      if (message.type === "stopRequest") {
        if (!this.processing) {
          return;
        }
        this.stopRequested = true;
        const stopMessage = "[System Message] User stopped the request while it was in progress.";
        this.history.push(createHistoryEntry("tool-execution", stopMessage, stopMessage, stopMessage));
        const activeTask = this.tasks.find((task) => task.id === this.currentTaskId);
        if (activeTask) {
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
            content: stopMessage,
            raw: stopMessage
          }
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
        if (this.pendingToolDecision) {
          this.pendingToolDecision("reject");
          this.pendingToolDecision = null;
        }
        if (this.pendingFollowupChoice) {
          this.pendingFollowupChoice("Skip");
          this.pendingFollowupChoice = null;
        }
        if (this.abortController) {
          this.abortController.abort();
        }
        send({ type: "toolRequestClear" });
        send({ type: "followupClear" });
        logEvent({
          level: "info",
          phase: "response",
          message: "Stop requested by user",
          taskId: this.currentTaskId
        });
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
        this.lastToolDecision = message.value || "reject";
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
        if (this.processing) {
          send({ type: "error", value: "Cannot add tasks while a request is running. Please wait for it to finish." });
          return;
        }
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
        this.autoApprove = getDefaultAutoApproveConfig();
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
        send({ type: "autoApprove", value: this.autoApprove });
        send({ type: "followupClear" });
        return;
      }

      if (message.type === "selectTask") {
        if (this.processing) {
          send({ type: "error", value: "Cannot switch tasks while a request is running. Please wait for it to finish." });
          return;
        }
        const taskId = message.value;
        const task = this.tasks.find((item) => item.id === taskId);
        if (task) {
          this.currentTaskId = taskId;
          this.history = task.history || [];
          this.autoApprove = getDefaultAutoApproveConfig();
          saveSarvamState(workspaceFolder, {
            settings: this.settings,
            tasks: this.tasks,
            currentTaskId: this.currentTaskId
          });
          send({ type: "history", value: buildDisplayHistory(this.history) });
          send({ type: "metrics", value: task.metrics || { contextLength: 0, inputTokens: 0, outputTokens: 0, contextWindow: defaults.contextWindow } });
          send({ type: "autoApprove", value: this.autoApprove });
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
        if (this.processing) {
          send({ type: "error", value: "Cannot delete tasks while a request is running. Please wait for it to finish." });
          return;
        }
        const taskId = message.value;
        const deletedTask = this.tasks.find((item) => item.id === taskId);
        if (deletedTask) {
          deleteTaskCheckpoints(workspaceFolder, deletedTask);
          // Close and clean up the shell session for the deleted task
          const deletedSessionId = this.taskShellSessions.get(taskId);
          if (deletedSessionId) {
            closeCommandSession(deletedSessionId);
            this.taskShellSessions.delete(taskId);
          }
        }
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
        return;
      }

      if (message.type === "restoreCheckpoint") {
        const checkpointId = message.value;
        const activeTask = this.tasks.find((task) => task.id === this.currentTaskId);
        const checkpoint = activeTask && activeTask.checkpoints ? activeTask.checkpoints.find((item) => item.id === checkpointId) : null;
        if (checkpoint && checkpoint.files && checkpoint.files.length) {
          try {
            const confirmation = await vscode.window.showWarningMessage(
              "Restoring this checkpoint will replace file contents and remove all later messages for this task.",
              { modal: true },
              "Restore"
            );
            if (confirmation !== "Restore") {
              return;
            }
            // Restore all checkpoints up to and including the target checkpoint
            const checkpoints = Array.isArray(activeTask.checkpoints) ? activeTask.checkpoints : [];
            const checkpointIndex = checkpoints.findIndex((item) => item.id === checkpointId);
            if (checkpointIndex >= 0) {
              const checkpointsToRestore = checkpoints.slice(checkpointIndex).reverse();
              checkpointsToRestore.forEach((cp) => {
                if (cp && cp.files && cp.files.length) {
                  restoreCheckpointSnapshot(getWorkspaceFolder(), cp);
                }
              });
            }
            pruneTaskAfterCheckpoint(workspaceFolder, activeTask, checkpointId);
            this.history = activeTask.history || [];
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
            send({ type: "followupClear" });
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
