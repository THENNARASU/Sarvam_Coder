const extractText = (value) => {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part.text === "string") {
          return part.text;
        }
        if (part && part.type === "output_text" && typeof part.output_text === "string") {
          return part.output_text;
        }
        return "";
      })
      .join("");
  }
  if (typeof value === "object") {
    if (typeof value.text === "string") {
      return value.text;
    }
    if (typeof value.content === "string") {
      return value.content;
    }
  }
  return "";
};

const buildFetchFailureMessage = (endpoint, error) => {
  const base = `SarvamAPI network request failed for ${endpoint}.`;
  if (!error) {
    return base;
  }

  const details = [];
  const cause = error.cause && typeof error.cause === "object" ? error.cause : null;
  const code = cause && cause.code ? String(cause.code) : "";
  const syscall = cause && cause.syscall ? String(cause.syscall) : "";
  const hostname = cause && cause.hostname ? String(cause.hostname) : "";
  const causeMessage = cause && cause.message ? String(cause.message) : "";
  const errorMessage = error.message ? String(error.message) : "";

  if (code) {
    details.push(`code=${code}`);
  }
  if (syscall) {
    details.push(`syscall=${syscall}`);
  }
  if (hostname) {
    details.push(`host=${hostname}`);
  }

  const message = causeMessage || errorMessage;
  if (message) {
    details.push(message);
  }

  return details.length > 0
    ? `${base} ${details.join(" | ")}`
    : base;
};

const streamChatCompletions = async ({ baseUrl, apiKey, model, messages, onDelta, signal }) => {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model,
    messages,
    stream: true
  };
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error(buildFetchFailureMessage(endpoint, error));
  }

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    throw new Error(`SarvamAPI request failed: ${response.status} ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let assistantText = "";
  let usage = null;
  const rawEvents = [];
  let pendingDataLines = [];
  // Track whether we are currently inside a reasoning_content block so we can
  // wrap those deltas in <thinking>...</thinking> tags in the assembled text.
  let inReasoningBlock = false;

  const processEventData = (data) => {
    const payloadText = String(data || "").trim();
    if (!payloadText || payloadText === "[DONE]") {
      return;
    }

    rawEvents.push(payloadText);

    try {
      const payload = JSON.parse(payloadText);
      const choice = payload.choices && payload.choices[0];
      const delta = choice && choice.delta;
      if (delta) {
        const reasoningDelta = extractText(delta.reasoning_content || "");
        const contentDelta = extractText(delta.content || delta.text || "");

        if (reasoningDelta) {
          // Open a <thinking> wrapper the first time reasoning content arrives.
          if (!inReasoningBlock) {
            const open = "<thinking>";
            assistantText += open;
            if (onDelta) onDelta(open);
            inReasoningBlock = true;
          }
          assistantText += reasoningDelta;
          if (onDelta) onDelta(reasoningDelta);
        }

        if (contentDelta) {
          // Close the thinking wrapper when we transition to regular content.
          if (inReasoningBlock) {
            const close = "</thinking>";
            assistantText += close;
            if (onDelta) onDelta(close);
            inReasoningBlock = false;
          }
          assistantText += contentDelta;
          if (onDelta) onDelta(contentDelta);
        }
      } else {
        const fallbackText = extractText((choice && choice.message && choice.message.content) || (choice && choice.text));
        if (fallbackText && !assistantText) {
          assistantText = fallbackText;
          if (onDelta) {
            onDelta(fallbackText);
          }
        }
      }
      if (payload.usage) {
        usage = payload.usage;
      }
    } catch (error) {
      // Ignore malformed JSON chunks.
    }
  };

  const processPhysicalLine = (line) => {
    const rawLine = String(line || "");
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (pendingDataLines.length > 0) {
        processEventData(pendingDataLines.join("\n"));
        pendingDataLines = [];
      }
      return;
    }

    if (trimmed.startsWith("data:")) {
      pendingDataLines.push(trimmed.slice(5).trim());
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      processPhysicalLine(line);
    }
  }

  // Flush pending decoder bytes and trailing lines.
  buffer += decoder.decode();
  const trailingLines = buffer.split(/\r?\n/);
  for (const line of trailingLines) {
    processPhysicalLine(line);
  }
  if (pendingDataLines.length > 0) {
    processEventData(pendingDataLines.join("\n"));
    pendingDataLines = [];
  }

  // Close any unclosed reasoning block (e.g. model stopped mid-stream).
  if (inReasoningBlock) {
    const close = "</thinking>";
    assistantText += close;
    if (onDelta) onDelta(close);
    inReasoningBlock = false;
  }

  const rawResponse = rawEvents.join("\n");

  return { assistantText, usage, rawResponse };
};

module.exports = {
  streamChatCompletions
};
