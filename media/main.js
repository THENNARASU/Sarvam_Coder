const vscode = acquireVsCodeApi();

const state = window.__SARVAM_STATE__ || { firstRun: true, settings: null, defaults: null };
const shell = document.querySelector(".shell");
const welcome = document.querySelector(".welcome");
const ready = document.querySelector(".ready");
const welcomeForm = document.querySelector(".welcome .settings");
const welcomeError = document.querySelector('[data-error="welcome"]');
const settingsPanel = document.querySelector(".settings-panel");
const settingsForm = document.querySelector(".settings-panel .settings");
const settingsError = document.querySelector('[data-error="settings"]');
const settingsToggle = document.querySelector(".settings-toggle");
const settingsSave = document.querySelector(".settings-save");
const settingsReset = document.querySelector(".settings-reset");
const settingsDone = document.querySelector(".settings-done");
const taskAddButton = document.querySelector(".task-add");
const taskHistoryButton = document.querySelector(".task-history");
const historyDoneButton = document.querySelector(".history-done");
const sendButton = document.querySelector(".send-button");
const taskPanel = document.querySelector(".task-panel");
const sendInput = document.querySelector(".ready-input textarea");
const conversation = document.querySelector(".conversation");
const contextLength = document.querySelector("[data-context-length]");
const contextMax = document.querySelector("[data-context-max]");
const contextFill = document.querySelector("[data-context-fill]");
const tokenIn = document.querySelector("[data-tokens-in]");
const tokenOut = document.querySelector("[data-tokens-out]");
const autoApproveLabel = document.querySelector("[data-auto-approve]");
const approvalPanel = document.querySelector(".tool-approval");
const approvalBody = document.querySelector(".tool-approval__body");
const approveButton = document.querySelector(".tool-approve");
const rejectButton = document.querySelector(".tool-reject");
const followupPanel = document.querySelector(".followup-panel");
const followupQuestion = document.querySelector(".followup-question");
const followupChoices = document.querySelector(".followup-choices");
const followupInput = document.querySelector(".followup-input");
const followupSend = document.querySelector(".followup-send");
const followupSkip = document.querySelector(".followup-skip");
const followupCustom = document.querySelector(".followup-custom");
let selectedFollowupOption = "";
const historyPanel = document.querySelector(".history-view");
const historyList = document.querySelector(".history-list");
const eventLogPanel = document.querySelector(".eventlog-view");
const eventLogList = document.querySelector(".eventlog-list");
const eventLogClose = document.querySelector(".eventlog-close");

const defaults = state.defaults || {
	baseUrl: "",
	apiKey: "",
	model: "",
	contextWindow: 0
};

const ensureDefaultPrompt = (force = false) => {
	if (!sendInput) {
		return;
	}
	if (shell && shell.dataset.hasConversation === "true") {
		return;
	}
	if (!force && sendInput.value.trim()) {
		return;
	}
	sendInput.value = "Analyze the project";
};

const setVisibleState = (isFirstRun) => {
	if (!shell || !welcome || !ready) {
		return;
	}

	shell.dataset.firstRun = isFirstRun ? "true" : "false";
	if (taskAddButton) {
		taskAddButton.style.display = isFirstRun ? "none" : "inline-flex";
	}
	if (taskHistoryButton) {
		taskHistoryButton.style.display = isFirstRun ? "none" : "inline-flex";
	}
};

const setError = (element, message) => {
	if (!element) {
		return;
	}

	if (message) {
		element.textContent = message;
		element.hidden = false;
	} else {
		element.textContent = "";
		element.hidden = true;
	}
};

const fillForm = (form, values) => {
	if (!form || !values) {
		return;
	}

	if (typeof values.baseUrl === "string") form.baseUrl.value = values.baseUrl;
	if (typeof values.apiKey === "string") form.apiKey.value = values.apiKey;
	if (typeof values.model === "string") form.model.value = values.model;
	if (typeof values.contextWindow !== "undefined") form.contextWindow.value = String(values.contextWindow);
	if (typeof values.toolMaxRepeat !== "undefined" && form.toolMaxRepeat) {
		form.toolMaxRepeat.value = String(values.toolMaxRepeat);
	}
};

const readForm = (form) => ({
	baseUrl: form.baseUrl.value.trim(),
	apiKey: form.apiKey.value.trim(),
	model: form.model.value.trim(),
	contextWindow: Number(form.contextWindow.value || 0),
	toolMaxRepeat: form.toolMaxRepeat ? Number(form.toolMaxRepeat.value || 0) : 0
});

const validateRequiredFields = (form, errorEl) => {
	if (!form || !form.apiKey || !form.baseUrl || !form.model || !form.contextWindow) {
		return false;
	}

	const baseUrl = form.baseUrl.value.trim();
	const apiKey = form.apiKey.value.trim();
	const model = form.model.value.trim();
	const contextWindow = Number(form.contextWindow.value || 0);

	if (!baseUrl || !apiKey || !model || !contextWindow) {
		setError(errorEl, "All fields are required.");
		return false;
	}

	setError(errorEl, "");
	return true;
};

const openSettings = () => {
	if (!settingsPanel) {
		return;
	}

	settingsPanel.classList.add("is-open");
	settingsPanel.setAttribute("aria-hidden", "false");
};

const toggleHistoryPanel = () => {
	if (!historyPanel) {
		return;
	}
	const isOpen = historyPanel.classList.toggle("is-open");
	historyPanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
};

const closeHistoryPanel = () => {
	if (!historyPanel) {
		return;
	}
	historyPanel.classList.remove("is-open");
	historyPanel.setAttribute("aria-hidden", "true");
};

const renderTasks = (tasks, currentTaskId) => {
	if (!historyList) {
		return;
	}
	historyList.innerHTML = "";
	tasks.forEach((task) => {
		const row = document.createElement("div");
		row.className = `history-item${task.id === currentTaskId ? " is-active" : ""}`;
		const header = document.createElement("div");
		header.className = "history-item__header";
		const title = document.createElement("button");
		title.type = "button";
		title.className = "history-item__title";
		const fallbackTitle = task.preview ? String(task.preview).split("\n")[0] : "Untitled";
		const defaultTitle = /^Task\s+\d+$/i.test(task.title || "") ? fallbackTitle : task.title;
		title.textContent = defaultTitle || fallbackTitle;
		title.addEventListener("click", () => {
			vscode.postMessage({ type: "selectTask", value: task.id });
			closeHistoryPanel();
		});
		const meta = document.createElement("div");
		meta.className = "history-item__meta";
		const metrics = task.metrics || {};
		const inputTokens = metrics.inputTokens || 0;
		const outputTokens = metrics.outputTokens || 0;
		meta.textContent = `Tokens: ${inputTokens} / ${outputTokens}`;

		let checkpointList = null;
		if (task.checkpoints && task.checkpoints.length) {
			checkpointList = document.createElement("div");
			checkpointList.className = "history-item__checkpoints";
			task.checkpoints.forEach((checkpoint) => {
				const checkpointRow = document.createElement("div");
				checkpointRow.className = "checkpoint-row";
				const checkpointLabel = document.createElement("span");
				checkpointLabel.textContent = `${checkpoint.label} (${checkpoint.timestamp})`;
				const restoreButton = document.createElement("button");
				restoreButton.type = "button";
				restoreButton.className = "checkpoint-restore";
				restoreButton.textContent = "Restore";
				restoreButton.disabled = !checkpoint.files || !checkpoint.files.length;
				restoreButton.addEventListener("click", (event) => {
					event.stopPropagation();
					vscode.postMessage({ type: "restoreCheckpoint", value: checkpoint.id });
				});
				checkpointRow.appendChild(checkpointLabel);
				checkpointRow.appendChild(restoreButton);
				checkpointList.appendChild(checkpointRow);
			});
		}
		const actions = document.createElement("div");
		actions.className = "history-item__actions";
		const open = document.createElement("button");
		open.type = "button";
		open.className = "history-item__open";
		open.textContent = "Open";
		open.addEventListener("click", (event) => {
			event.stopPropagation();
			vscode.postMessage({ type: "selectTask", value: task.id });
			closeHistoryPanel();
		});
		const del = document.createElement("button");
		del.type = "button";
		del.className = "history-item__delete";
		del.textContent = "Delete";
		del.addEventListener("click", (event) => {
			event.stopPropagation();
			vscode.postMessage({ type: "deleteTask", value: task.id });
		});
		actions.appendChild(open);
		actions.appendChild(del);
		header.appendChild(title);
		header.appendChild(actions);
		const content = document.createElement("div");
		content.appendChild(header);
		content.appendChild(meta);
		if (checkpointList) {
			content.appendChild(checkpointList);
		}
		row.appendChild(content);
		historyList.appendChild(row);
	});
};

const closeSettings = () => {
	if (!settingsPanel) {
		return;
	}

	settingsPanel.classList.remove("is-open");
	settingsPanel.setAttribute("aria-hidden", "true");
};

let activeAssistant = null;
let activeAssistantRaw = "";
const sanitizeAssistantText = (text) => {
	if (!text) {
		return "";
	}
	let cleaned = text;
	// Only truncate system prompt if present
	cleaned = cleaned.replace(
		/(<system_prompt>[\s\S]{0,500})[\s\S]*?(<\/system_prompt>)/gi,
		"$1... [truncated] ...$2"
	);
	return cleaned
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
};

const stripToolXmlClient = (text) => {
	if (!text) {
		return "";
	}
	let cleaned = String(text)
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
		.replace(/<apply_diff>[\s\S]*?<\/apply_diff>/gi, " ")
		.replace(/<search_and_replace>[\s\S]*?<\/search_and_replace>/gi, " ")
		.replace(/<insert_content>[\s\S]*?<\/insert_content>/gi, " ")
		.replace(/<list_code_definition_names>[\s\S]*?<\/list_code_definition_names>/gi, " ")
		.replace(/<update_todo_list>[\s\S]*?<\/update_todo_list>/gi, " ")
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
};

const extractThinking = (raw) => {
	if (!raw) {
		return "";
	}
	const match = String(raw).match(/<thinking>([\s\S]*?)<\/thinking>/i);
	return match ? String(match[1]).trim() : "";
};

const setConversationFlag = (hasConversation) => {
	if (!shell) {
		return;
	}
	shell.dataset.hasConversation = hasConversation ? "true" : "false";
	if (hasConversation && sendInput && sendInput.value.trim() === "Analyze the project") {
		sendInput.value = "";
	}
};

const createMessageBase = (role, contentText) => {
       if (!conversation) {
	       return null;
       }
       const entry = document.createElement("div");
       entry.className = `message message--${role}`;
       const icon = document.createElement("span");
       icon.className = "message-icon";
	       // Enhanced: Show right arrow for tool requests/results, center and color green
	       let showRightArrow = false;
	       const contentLower = typeof contentText === "string" ? contentText.trim().toLowerCase() : "";
	       if (
		       role === "forward" ||
		       role === "tool-execution" ||
		       contentLower.startsWith("tool result") ||
		       contentLower.startsWith("tool request") ||
		       contentLower.includes("<tool_call>")
	       ) {
		       showRightArrow = true;
	       }
	       if (showRightArrow) {
		       icon.textContent = "→";
		       icon.classList.add("message-icon--tool-green");
	       } else if (role === "assistant") {
	       const sarvamIconSrc = shell ? shell.dataset.sarvamIcon || "" : "";
	       if (sarvamIconSrc) {
		       const img = document.createElement("img");
		       img.alt = "Sarvam";
		       img.src = sarvamIconSrc;
		       icon.classList.add("message-icon--sarvam");
		       icon.appendChild(img);
	       } else {
		       icon.classList.add("message-icon--sarvam");
	       }
       } else if (role === "tool-approval") {
	       // Tool approval requests from model/endpoint should use Sarvam icon
	       const sarvamIconSrc = shell ? shell.dataset.sarvamIcon || "" : "";
	       if (sarvamIconSrc) {
		       const img = document.createElement("img");
		       img.alt = "Sarvam";
		       img.src = sarvamIconSrc;
		       icon.classList.add("message-icon--sarvam");
		       icon.appendChild(img);
	       } else {
		       icon.classList.add("message-icon--sarvam");
	       }
       } else {
	       icon.textContent = "U";
	       icon.classList.add("message-icon--user");
	       icon.style.verticalAlign = "middle";
	       icon.style.marginTop = "0";
       }
       const content = document.createElement("div");
       content.className = "message-content";
       entry.appendChild(icon);
       entry.appendChild(content);
       conversation.appendChild(entry);
       conversation.scrollTop = conversation.scrollHeight;
       return { entry, content };
};

// Utility: decode all HTML entities (not just &lt; &gt;)
function decodeHTMLEntities(str) {
	if (!str) return "";
	const txt = document.createElement('textarea');
	txt.innerHTML = str;
	return txt.value;
}

const formatToolSummaryFromName = (toolName) => {
	const name = String(toolName || "").trim();
	if (!name) {
		return "";
	}
	if (name === "list_files") return "Listing files";
	if (name === "read_file") return "Reading file";
	if (name === "write_to_file") return "Writing file";
	if (name === "apply_diff") return "Updating file";
	if (name === "search_and_replace") return "Updating file";
	if (name === "insert_content") return "Updating file";
	if (name === "search_files") return "Searching files";
	if (name === "list_code_definition_names") return "Listing code definitions";
	if (name === "execute_command") return "Running command";
	if (name === "update_todo_list") return "Updating todo list";
	return name.replace(/_/g, " ");
};

const appendMessage = (role, text, rawText) => {
	const base = createMessageBase(role, text);
	if (!base) {
		return null;
	}
	const safeText = (typeof text === "string" && text.trim().length > 0) ? text : "(no content)";
	const rawValue = typeof rawText === "string" ? rawText : safeText;
	const assistantDisplay = role === "assistant" ? stripToolXmlClient(rawValue || safeText) : "";
	const displayText = role === "assistant" ? assistantDisplay : safeText;
	const thinking = extractThinking(rawValue);
	const isToolResult = role === "tool-execution" && /^Tool result \(/i.test(String(safeText));
	if (isToolResult) {
		const lines = String(safeText).split(/\r?\n/);
		const firstLine = lines.shift() || "";
		const detailText = lines.join("\n").trim();
		const decodedDetail = decodeHTMLEntities(detailText || "");
		const details = document.createElement("details");
		details.className = "message-tool-result";
		const summary = document.createElement("summary");
		const match = firstLine.match(/^Tool result \(([^)]+)\):?\s*(.*)$/i);
		let summaryText = match && match[2] ? match[2] : "";
		if (!summaryText && match && match[1]) {
			summaryText = formatToolSummaryFromName(match[1]);
		}
		if (!summaryText) {
			summaryText = firstLine || "Tool result";
		}
		summary.textContent = summaryText.trim();
		const body = document.createElement("pre");
		body.textContent = decodedDetail || "(no output)";
		details.appendChild(summary);
		details.appendChild(body);
		base.content.innerHTML = "";
		base.content.insertBefore(details, base.content.firstChild);
	} else if (
		typeof safeText === "string" &&
		(/<[a-z][\s\S]*>/i.test(safeText) || safeText.includes("&lt;"))
	) {
		if (role === "assistant") {
			base.content.textContent = displayText;
		} else {
			const decoded = decodeHTMLEntities(safeText);
			const pre = document.createElement("pre");
			pre.className = "message-pre";
			pre.textContent = decoded;
			base.content.innerHTML = "";
			base.content.appendChild(pre);
		}
	} else {
		base.content.textContent = displayText;
	}
	if (thinking) {
		const details = document.createElement("details");
		details.className = "message-thinking";
		const summary = document.createElement("summary");
		summary.textContent = "Show thinking";
		const body = document.createElement("pre");
		body.textContent = thinking;
		details.appendChild(summary);
		details.appendChild(body);
		base.content.insertBefore(details, base.content.firstChild);
	}
	return base.entry;
};

const attachThinkingToMessage = (entry, rawText) => {
	if (!entry) {
		return;
	}
	const content = entry.querySelector(".message-content");
	if (!content) {
		return;
	}
	if (content.querySelector(".message-thinking")) {
		return;
	}
	const thinking = extractThinking(rawText);
	if (!thinking) {
		return;
	}
	const details = document.createElement("details");
	details.className = "message-thinking";
	const summary = document.createElement("summary");
	summary.textContent = "Show thinking";
	const body = document.createElement("pre");
	body.textContent = thinking;
	details.appendChild(summary);
	details.appendChild(body);
	content.insertBefore(details, content.firstChild);
};

const updateStreamingThinking = (entry, rawText) => {
	if (!entry || !rawText) {
		return;
	}
	const content = entry.querySelector(".message-content");
	if (!content) {
		return;
	}
	const raw = String(rawText);
	const startIndex = raw.indexOf("<thinking>");
	if (startIndex < 0) {
		return;
	}
	const endIndex = raw.indexOf("</thinking>");
	const startOffset = startIndex + "<thinking>".length;
	const thinkingValue = endIndex >= 0 ? raw.slice(startOffset, endIndex) : raw.slice(startOffset);
	let details = content.querySelector(".message-thinking");
	if (!details) {
		details = document.createElement("details");
		details.className = "message-thinking";
		const summary = document.createElement("summary");
		summary.textContent = "Show thinking";
		const body = document.createElement("pre");
		details.appendChild(summary);
		details.appendChild(body);
		content.insertBefore(details, content.firstChild);
	}
	const body = details.querySelector("pre");
	if (body) {
		body.textContent = thinkingValue.trim();
	}
};

const appendTodoList = (items) => {
	const base = createMessageBase("todo");
	if (!base) {
		return null;
	}
	const list = document.createElement("ul");
	list.className = "todo-list";
	(items || []).forEach((item) => {
		const row = document.createElement("li");
		row.className = "todo-item";
		const status = document.createElement("span");
		status.className = "todo-status";
		status.textContent = item.status || "[ ]";
		const text = document.createElement("span");
		text.className = "todo-text";
		text.textContent = item.text || "";
		row.appendChild(status);
		row.appendChild(text);
		list.appendChild(row);
	});
	base.content.appendChild(list);
	return base.entry;
};

const openEventLog = () => {
	if (!eventLogPanel) {
		return;
	}
	eventLogPanel.classList.add("is-open");
	eventLogPanel.setAttribute("aria-hidden", "false");
};

const closeEventLog = () => {
	if (!eventLogPanel) {
		return;
	}
	eventLogPanel.classList.remove("is-open");
	eventLogPanel.setAttribute("aria-hidden", "true");
};

const formatEventLogItem = (item) => {
	const timestamp = item.timestamp || "";
	const message = item.message || "";
	return `${timestamp} - ${message}`.trim();
};

let eventLogItems = [];
let lastToolResultText = "";

const parseRequestForDisplay = (rawRequest) => {
	if (!rawRequest) {
		return { displayText: "", systemPrompt: "" };
	}
	try {
		const parsed = JSON.parse(rawRequest);
		const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
		let systemPrompt = "";
		const safeMessages = messages.map((msg) => {
			if (msg && msg.role === "system") {
				systemPrompt = String(msg.content || "");
				return { ...msg, content: "[system prompt hidden]" };
			}
			return msg;
		});
		const safePayload = { ...parsed, messages: safeMessages };
		return { displayText: JSON.stringify(safePayload, null, 2), systemPrompt };
	} catch (error) {
		return { displayText: String(rawRequest), systemPrompt: "" };
	}
};

const renderEventLog = (items) => {
	if (!eventLogList) {
		return;
	}
	eventLogList.innerHTML = "";
	delete eventLogList.dataset.phase;
	let currentPhase = null;
	let currentRequestId = null;
	(items || []).forEach((item) => {
		const message = item && item.message ? String(item.message) : "";
		const phase = item && item.phase ? String(item.phase).toLowerCase() : "";
		const requestId = item && item.requestId ? String(item.requestId) : "";
		if (requestId && requestId !== currentRequestId) {
			currentRequestId = requestId;
			currentPhase = null;
			delete eventLogList.dataset.phase;
		}
		if (phase) {
			currentPhase = phase;
		} else if (/request started/i.test(message)) {
			currentPhase = "request";
		} else if (/model response received/i.test(message)) {
			currentPhase = "response";
		} else if (!currentPhase) {
			currentPhase = "request";
		}
		const headerClass = currentPhase === "request" ? "Request" : "Response";
		if (currentPhase !== eventLogList.dataset.phase) {
			const header = document.createElement("div");
			header.className = `eventlog-phase eventlog-phase--${currentPhase}`;
			header.textContent = headerClass;
			eventLogList.appendChild(header);
			eventLogList.dataset.phase = currentPhase;
		}
		const row = document.createElement("div");
		row.className = `eventlog-row eventlog-row--${item.level || "info"}`;

		if (item.rawRequest) {
			const requestInfo = parseRequestForDisplay(item.rawRequest);
			const requestBlock = document.createElement("pre");
			requestBlock.className = "eventlog-row__detail";
			requestBlock.style.whiteSpace = "pre-wrap";
			requestBlock.textContent = requestInfo.displayText || "(empty request)";
			row.appendChild(requestBlock);
			if (requestInfo.systemPrompt) {
				const systemButton = document.createElement("button");
				systemButton.className = "eventlog-toggle";
				systemButton.textContent = "Show system prompt";
				systemButton.addEventListener("click", () => {
					vscode.postMessage({ type: "showSystemPromptFromLog", value: requestInfo.systemPrompt });
				});
				row.appendChild(systemButton);
			}
		}

		// Toggle for raw/final response
		if (item.rawResponse && item.finalResponse) {
			const toggleBtn = document.createElement("button");
			toggleBtn.textContent = "Show Raw";
			toggleBtn.className = "eventlog-toggle";
			const detailLine = document.createElement("pre");
			detailLine.className = "eventlog-row__detail";
			detailLine.style.whiteSpace = "pre-wrap";
			detailLine.textContent = item.finalResponse;
			let showingRaw = false;
			toggleBtn.onclick = () => {
				showingRaw = !showingRaw;
				detailLine.textContent = showingRaw ? item.rawResponse : item.finalResponse;
				toggleBtn.textContent = showingRaw ? "Show Final" : "Show Raw";
			};
			row.appendChild(toggleBtn);
			row.appendChild(detailLine);
		} else if (item.rawResponse) {
			const detailLine = document.createElement("pre");
			detailLine.className = "eventlog-row__detail";
			detailLine.style.whiteSpace = "pre-wrap";
			detailLine.textContent = item.rawResponse;
			row.appendChild(detailLine);
		} else if (item.finalResponse) {
			const detailLine = document.createElement("pre");
			detailLine.className = "eventlog-row__detail";
			detailLine.style.whiteSpace = "pre-wrap";
			detailLine.textContent = item.finalResponse;
			row.appendChild(detailLine);
		} else if (item.detail) {
			const detailLine = document.createElement("pre");
			detailLine.className = "eventlog-row__detail";
			detailLine.style.whiteSpace = "pre-wrap";
			detailLine.textContent = String(item.detail);
			row.appendChild(detailLine);
		}
		// Always show the message line (timestamp, etc)
		const messageLine = document.createElement("div");
		messageLine.className = "eventlog-row__message";
		messageLine.textContent = formatEventLogItem(item);
		row.appendChild(messageLine);
		eventLogList.appendChild(row);
	});
	eventLogList.scrollTop = eventLogList.scrollHeight;
};

const updateMetrics = (metrics) => {
	if (!metrics) {
		return;
	}

	if (contextLength) {
		contextLength.textContent = String(metrics.contextLength || 0);
	}
	if (contextMax) {
		contextMax.textContent = String(metrics.contextWindow || "");
	}
	if (tokenIn) {
		tokenIn.textContent = String(metrics.inputTokens || 0);
	}
	if (tokenOut) {
		tokenOut.textContent = String(metrics.outputTokens || 0);
	}
	if (contextFill && metrics.contextWindow) {
		const ratio = Math.min(1, (metrics.contextLength || 0) / metrics.contextWindow);
		contextFill.style.width = `${Math.round(ratio * 100)}%`;
	}
};

const setAutoApproveLabel = (value) => {
	if (!autoApproveLabel || !value) {
		return;
	}
	if (typeof value === "string") {
		autoApproveLabel.textContent = value;
		return;
	}
	if (value.other) {
		autoApproveLabel.textContent = "All except read/write/execute";
		return;
	}
	const enabled = Object.entries(value)
		.filter(([, enabledValue]) => enabledValue)
		.map(([key]) => key);
	autoApproveLabel.textContent = enabled.length ? enabled.join(", ") : "None";
};

const clearToolApproval = () => {
	if (!approvalPanel || !approvalBody) {
		return;
	}
	approvalBody.textContent = "";
	approvalPanel.hidden = true;
	approvalPanel.classList.remove("is-open");
};

const clearFollowup = () => {
	if (!followupPanel || !followupQuestion || !followupChoices) {
		return;
	}
	followupQuestion.textContent = "";
	followupChoices.innerHTML = "";
	if (followupInput) {
		followupInput.value = "";
	}
	if (followupCustom) {
		followupCustom.classList.remove("is-selected");
	}
	selectedFollowupOption = "";
	followupPanel.hidden = true;
	followupPanel.classList.remove("is-open");
};

const showFollowup = (payload) => {
	if (!followupPanel || !followupQuestion || !followupChoices) {
		return;
	}
	const question = payload?.question ? String(payload.question) : "";
	const options = Array.isArray(payload?.options) ? payload.options : [];
	const selected = payload?.selected ? String(payload.selected) : "";
	followupQuestion.textContent = question || "Choose one";
	followupChoices.innerHTML = "";
	selectedFollowupOption = "";
	if (followupCustom) {
		followupCustom.classList.remove("is-selected");
	}
	options.forEach((option) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "followup-choice";
		button.textContent = option;
		button.addEventListener("click", () => {
			selectedFollowupOption = option;
			if (followupInput) {
				followupInput.value = option;
				followupInput.focus();
			}
			const buttons = followupChoices.querySelectorAll(".followup-choice");
			buttons.forEach((item) => item.classList.remove("is-selected"));
			button.classList.add("is-selected");
			if (followupCustom) {
				followupCustom.classList.remove("is-selected");
			}
		});
		if (selected && option === selected) {
			button.classList.add("is-selected");
			selectedFollowupOption = option;
		}
		followupChoices.appendChild(button);
	});
	if (followupCustom) {
		followupChoices.appendChild(followupCustom);
	}
	clearToolApproval();
	followupPanel.hidden = false;
	followupPanel.classList.add("is-open");
	if (followupInput) {
		const isCustom = selected && !options.includes(selected);
		followupInput.value = isCustom ? selected : "";
		followupInput.focus();
		if (isCustom && followupCustom) {
			followupCustom.classList.add("is-selected");
			selectedFollowupOption = selected;
		}
	}
};

const submitFollowupInput = () => {
	const inputValue = followupInput ? followupInput.value.trim() : "";
	const value = inputValue || selectedFollowupOption;
	if (!value) {
		return;
	}
	clearFollowup();
	vscode.postMessage({ type: "followupChoice", value });
};

const showToolApproval = (toolRequest) => {
	if (!approvalPanel || !approvalBody) {
		return;
	}
	clearFollowup();
	if (!toolRequest || !toolRequest.name || toolRequest.name === "thinking" || toolRequest.name === "analysis") {
		clearToolApproval();
		return;
	}
	if (toolRequest.autoApproved) {
		clearToolApproval();
		return;
	}
	const summary = toolRequest.summary || toolRequest.name || "Tool request";
	const detail = toolRequest.detail ? `\n${toolRequest.detail}` : "";
	approvalBody.textContent = `${summary}${detail}`;
	approvalPanel.hidden = false;
	approvalPanel.classList.add("is-open");
};

fillForm(welcomeForm, state.settings || defaults);
fillForm(settingsForm, state.settings || defaults);
setVisibleState(Boolean(state.firstRun));
setConversationFlag(Boolean(state.hasConversation));
clearToolApproval();
clearFollowup();
if (!state.firstRun && !state.hasConversation) {
	ensureDefaultPrompt(true);
}

if (settingsToggle) {
	settingsToggle.addEventListener("click", () => {
		openSettings();
	});
}

if (taskAddButton) {
	taskAddButton.addEventListener("click", () => {
		vscode.postMessage({ type: "addTask" });
	});
}

if (taskHistoryButton) {
	taskHistoryButton.addEventListener("click", () => {
		toggleHistoryPanel();
	});
}

if (taskPanel) {
	taskPanel.addEventListener("contextmenu", (event) => {
		event.preventDefault();
		vscode.postMessage({ type: "showEventLog" });
	});
}

if (historyDoneButton) {
	historyDoneButton.addEventListener("click", () => {
		closeHistoryPanel();
	});
}

if (eventLogClose) {
	eventLogClose.addEventListener("click", () => {
		closeEventLog();
	});
}

if (settingsDone) {
	settingsDone.addEventListener("click", () => {
		closeSettings();
		setError(settingsError, "");
	});
}

if (settingsReset) {
	settingsReset.addEventListener("click", () => {
		vscode.postMessage({ type: "resetSettings" });
	});
}

if (settingsSave && settingsForm) {
	settingsSave.addEventListener("click", () => {
		if (!validateRequiredFields(settingsForm, settingsError)) {
			return;
		}

		const payload = readForm(settingsForm);
		vscode.postMessage({ type: "saveSettings", value: payload });
		setVisibleState(false);
		closeSettings();
	});
}

if (welcomeForm) {
	welcomeForm.addEventListener("submit", (event) => {
		event.preventDefault();
		if (!validateRequiredFields(welcomeForm, welcomeError)) {
			return;
		}

		const payload = readForm(welcomeForm);
		vscode.postMessage({ type: "saveSettings", value: payload });
		setVisibleState(false);
	});
}

if (sendButton) {
	sendButton.addEventListener("click", () => {
		if (!sendInput) {
			return;
		}
		const text = sendInput.value.trim();
		if (!text) {
			return;
		}
		appendMessage("user", text, text);
		setConversationFlag(true);
		sendInput.value = "";
		clearToolApproval();
		clearFollowup();
		vscode.postMessage({ type: "userMessage", value: text });
	});
  sendButton.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    vscode.postMessage({ type: "showSystemPrompt" });
  });
}

if (approveButton) {
	approveButton.addEventListener("click", () => {
		if (approvalPanel) {
			approvalPanel.hidden = true;
		}
		vscode.postMessage({ type: "toolDecision", value: "approve" });
	});
}

if (rejectButton) {
	rejectButton.addEventListener("click", () => {
		if (approvalPanel) {
			approvalPanel.hidden = true;
		}
		vscode.postMessage({ type: "toolDecision", value: "reject" });
	});
}

if (followupSend) {
	followupSend.addEventListener("click", () => {
		submitFollowupInput();
	});
}

if (followupSkip) {
	followupSkip.addEventListener("click", () => {
		clearFollowup();
		vscode.postMessage({ type: "followupChoice", value: "Skip" });
	});
}

if (followupInput) {
	followupInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			submitFollowupInput();
		}
	});
	followupInput.addEventListener("input", () => {
		const value = followupInput.value.trim();
		selectedFollowupOption = value;
		const buttons = followupChoices ? followupChoices.querySelectorAll(".followup-choice") : [];
		buttons.forEach((item) => item.classList.remove("is-selected"));
		if (followupCustom) {
			if (value) {
				followupCustom.classList.add("is-selected");
			} else {
				followupCustom.classList.remove("is-selected");
			}
		}
	});
}

window.addEventListener("message", (event) => {
	const message = event.data;
	if (!message || !message.type) {
		return;
	}

	if (message.type === "assistantDelta") {
		if (!activeAssistant) {
			activeAssistant = appendMessage("assistant", "", "");
			activeAssistantRaw = "";
		}
		activeAssistantRaw += message.value || "";
		if (activeAssistant) {
			const content = activeAssistant.querySelector(".message-content");
			if (content) {
				const stripped = stripToolXmlClient(activeAssistantRaw);
				content.textContent = sanitizeAssistantText(stripped);
			}
			updateStreamingThinking(activeAssistant, activeAssistantRaw);
		}
	}

	if (message.type === "assistantDone") {
		if (message.value?.text || message.value?.raw) {
			const baseText = message.value?.text
				? message.value.text
				: stripToolXmlClient(message.value?.raw || "");
			const displayText = sanitizeAssistantText(baseText || "");
			if (activeAssistant) {
				const content = activeAssistant.querySelector(".message-content");
				if (content) {
					content.textContent = displayText;
				}
				attachThinkingToMessage(activeAssistant, message.value.raw || message.value.text);
				if (!displayText && !extractThinking(message.value.raw || message.value.text)) {
					activeAssistant.remove();
					activeAssistant = null;
				}
			} else {
				if (displayText) {
					appendMessage(
						"assistant",
						displayText,
						message.value.raw || message.value.text
					);
				}
			}
		}
		activeAssistant = null;
		activeAssistantRaw = "";
		clearToolApproval();
		setConversationFlag(true);
	}

	if (message.type === "toolRequest") {
		// Show Sarvam icon for tool approval request
		const toolSummary = message.value?.summary || message.value?.name || "Tool";
		const toolDetail = message.value?.detail ? ` (${message.value.detail})` : "";
		appendMessage("tool-execution", `${toolSummary}${toolDetail}`, message.value?.raw || toolSummary);
		showToolApproval(message.value || {});
	}

	if (message.type === "toolDecisionAck") {
		clearToolApproval();
	}

	if (message.type === "toolRequestClear") {
		clearToolApproval();
	}

	if (message.type === "followupPrompt") {
		showFollowup(message.value || {});
	}

	if (message.type === "followupClear") {
		clearFollowup();
	}


	if (message.type === "toolResult") {
		clearToolApproval();
		// Tool result is from client-side tool execution, use right arrow icon
		const formatted = `Tool result (${message.value.name}):\n${message.value.result}`;
		lastToolResultText = formatted;
		appendMessage("tool-execution", formatted, formatted);
	}

	if (message.type === "todoList") {
		clearToolApproval();
		// Tool execution in progress, use right arrow icon
		const toolName = message.value?.name || "tool";
		const summary = formatToolSummaryFromName(toolName) || toolName;
		appendMessage("tool-execution", `Auto-running ${summary}...`, `Auto-running ${summary}...`);
	}

	if (message.type === "autoTool") {
		clearToolApproval();
		const toolName = message.value?.name || "tool";
		const summary = formatToolSummaryFromName(toolName) || toolName;
		appendMessage("tool-execution", `Auto-running ${summary}...`, `Auto-running ${summary}...`);
	}

	if (message.type === "metrics") {
		updateMetrics(message.value);
	}

	if (message.type === "history" && Array.isArray(message.value)) {
		if (conversation) {
			conversation.innerHTML = "";
		}
			       message.value.forEach((entry) => {
				       let role = entry.role;
			       const contentValue = typeof entry.content === "string" ? entry.content.trim() : "";
			       const rawValue = typeof entry.raw === "string" ? entry.raw : "";
			       if (role === "assistant" && !contentValue && rawValue && extractThinking(rawValue)) {
				       appendMessage(role, "", rawValue);
				       return;
			       }
			       if (role === "assistant" && !contentValue && /<\/?[a-z][\s\S]*?>/i.test(rawValue)) {
				       return;
			       }
				       // If a user message is actually a tool result, show as tool-execution (right arrow)
				       if (
					       (role === "user" && typeof entry.content === "string" && entry.content.trim().toLowerCase().startsWith("tool result")) ||
					       (role === "tool-result" || role === "tool_result" || role === "toolresult")
				       ) {
					       role = "tool-execution";
				       }
				       if (
					       role === "user" ||
					       role === "assistant" ||
					       role === "tool" ||
					       role === "error" ||
					       role === "tool-execution" ||
					       role === "forward"
				       ) {
						appendMessage(role, entry.content, entry.raw);
				       }
			       });
		setConversationFlag(message.value.length > 0);
		clearToolApproval();
		if (!message.value.length) {
			ensureDefaultPrompt();
		}
	}

	if (message.type === "tasks") {
		const payload = message.value || {};
		renderTasks(payload.tasks || [], payload.currentTaskId);
	}

	if (message.type === "autoApprove") {
		setAutoApproveLabel(message.value);
	}

	if (message.type === "error") {
		clearToolApproval();
		clearFollowup();
		appendMessage("error", message.value || "Error", message.value || "Error");
	}

	if (message.type === "historyAppend") {
		const entry = message.value || {};
		if (entry.role && (entry.content || entry.raw)) {
			// Remap tool result roles to 'tool-execution' for consistent icon display
			if (
				(entry.role === "user" && typeof entry.content === "string" && entry.content.trim().toLowerCase().startsWith("tool result")) ||
				(entry.role === "tool-result" || entry.role === "tool_result" || entry.role === "toolresult")
			) {
				entry.role = "tool-execution";
			}
			if (entry.role === "tool-execution" && entry.content && entry.content === lastToolResultText) {
				lastToolResultText = "";
				return;
			}
			appendMessage(entry.role, entry.content || "", entry.raw);
			setConversationFlag(true);
		}
	}

	if (message.type === "eventLogSnapshot") {
		eventLogItems = Array.isArray(message.value) ? message.value : [];
		renderEventLog(eventLogItems);
		openEventLog();
	}

	if (message.type === "eventLog") {
		if (message.value) {
			eventLogItems.push(message.value);
			renderEventLog(eventLogItems);
		}
	}
});
