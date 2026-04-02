const { decodeXmlEntities } = require("./helpers");

const parseArgsFromXml = (raw) => {
  const args = {};
  const argRegex = /<([a-zA-Z0-9_-]+)>([\s\S]*?)<\/\1>/g;
  let argMatch;
  while ((argMatch = argRegex.exec(raw))) {
    const key = argMatch[1];
    const value = argMatch[2].trim();
    if (!args[key]) {
      args[key] = [];
    }
    args[key].push(value);
  }

  if (args.diff && args.diff.length) {
    args.diff = args.diff.map((value) => decodeXmlEntities(value));
  }

  const argKeyValues = [];
  const argKeyRegex = /<arg_key>([\s\S]*?)<\/arg_key>/g;
  const argValueRegex = /<arg_value>([\s\S]*?)<\/arg_value>/g;
  let keyMatch;
  let valueMatch;
  while ((keyMatch = argKeyRegex.exec(raw))) {
    argKeyValues.push({ key: keyMatch[1].trim(), value: "" });
  }
  let index = 0;
  while ((valueMatch = argValueRegex.exec(raw))) {
    if (!argKeyValues[index]) {
      argKeyValues[index] = { key: "", value: "" };
    }
    argKeyValues[index].value = valueMatch[1].trim();
    index += 1;
  }

  if (args.arg_key && args.arg_value) {
    const count = Math.min(args.arg_key.length, args.arg_value.length);
    for (let i = 0; i < count; i += 1) {
      argKeyValues.push({
        key: String(args.arg_key[i] || "").trim(),
        value: String(args.arg_value[i] || "").trim()
      });
    }
  }

  argKeyValues.forEach(({ key, value }) => {
    if (!key) {
      return;
    }
    if (!args[key]) {
      args[key] = [];
    }
    args[key].push(value);
  });

  if (!args.path) {
    const pathRegex = /<path>([\s\S]*?)<\/path>/g;
    let pathMatch;
    while ((pathMatch = pathRegex.exec(raw))) {
      const value = pathMatch[1].trim();
      if (!args.path) {
        args.path = [];
      }
      args.path.push(value);
    }
  }

  return args;
};

const parseArgsFromJson = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    const args = {};
    Object.entries(parsed || {}).forEach(([key, value]) => {
      args[key] = Array.isArray(value) ? value.map(String) : [String(value)];
    });
    return args;
  } catch (error) {
    return null;
  }
};

const extractToolCall = (text) => {
  const tagRegex = /<([a-zA-Z0-9_-]+)>[\s\S]*?<\/\1>/g;
  const allowedTools = new Set([
    "title_name",
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
  ]);
  let match;
  while ((match = tagRegex.exec(text))) {
    const raw = match[0];
    const name = match[1];
    if (name === "thinking" || name === "analysis" || name === "attempt_completion") {
      continue;
    }

    if (name === "tool_call" || name === "tool") {
      const nameMatch = raw.match(/<name>([\s\S]*?)<\/name>/);
      const argsMatch = raw.match(/<(arguments|args)>([\s\S]*?)<\/(arguments|args)>/);
      if (!nameMatch) {
        const inlineNameMatch = raw.match(/<tool_call>\s*([a-zA-Z0-9_-]+)>?/);
        if (!inlineNameMatch) {
          continue;
        }
        const inlineName = inlineNameMatch[1].trim();
        const args = parseArgsFromXml(raw);
        args.raw = raw;
        return { name: inlineName, raw, args };
      }
      const toolName = nameMatch[1].trim();
      let args = {};
      if (argsMatch) {
        const argsPayload = argsMatch[2].trim();
        if (argsPayload.startsWith("{")) {
          args = parseArgsFromJson(argsPayload) || {};
        } else {
          args = parseArgsFromXml(argsPayload);
        }
      }
      args.raw = raw;
      return { name: toolName, raw, args };
    }

    if (!allowedTools.has(name)) {
      continue;
    }
    const innerMatch = raw.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`));
    const innerPayload = innerMatch ? innerMatch[1] : raw;
    const args = parseArgsFromXml(innerPayload);
    args.raw = raw;
    return { name, raw, args };
  }

  const looseMatch = text.match(/<tool_call>\s*([a-zA-Z0-9_-]+)>?([\s\S]*)/);
  if (looseMatch) {
    const name = looseMatch[1].trim();
    if (allowedTools.has(name)) {
      const raw = looseMatch[0];
      const args = parseArgsFromXml(looseMatch[2] || "");
      args.raw = raw;
      return { name, raw, args };
    }
  }

  return null;
};

module.exports = {
  extractToolCall
};
