const streamChatCompletions = async ({ baseUrl, apiKey, model, messages, onDelta }) => {
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const payload = {
    model,
    messages,
    stream: true
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    throw new Error(`SarvamAPI request failed: ${response.status} ${errorText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let assistantText = "";
  let usage = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) {
        continue;
      }

      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        break;
      }

      try {
        const payload = JSON.parse(data);
        const choice = payload.choices && payload.choices[0];
        const delta = choice && choice.delta ? choice.delta.content || "" : "";
        if (delta) {
          assistantText += delta;
          if (onDelta) {
            onDelta(delta);
          }
        }
        if (payload.usage) {
          usage = payload.usage;
        }
      } catch (error) {
        // Ignore malformed JSON chunks.
      }
    }
  }

  return { assistantText, usage };
};

module.exports = {
  streamChatCompletions
};
