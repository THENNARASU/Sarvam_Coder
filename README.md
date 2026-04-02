# Sarvam Coder Extension (Minimal v1)

This is a VS Code extension (no local web server), designed to send user coding tasks and request model to provide a response for the following tools implemented within the extension:
- Read File(s) [read_file]
- Search File(s) [search_files]
- List file(s) [list_files]
- List Code definition Name(s) [list_code_definition_names]
- Search/Replace [apply_diff, search_and_replace]
- Write File [write_to_file]
- Insert Content [insert_content]
- Execute Command [execute_command]
- Followup Question [ask_followup_question]
- To Do List [update_todo_list]
- Attempt Completion [attempt_completion]

## Tool structure

Tool parsing and execution are split into small modules:

- Parser: [lib/tools/parser.js](lib/tools/parser.js) extracts tool calls + args.
- Helpers: [lib/tools/helpers.js](lib/tools/helpers.js) for path safety and diff parsing.
- Runner entrypoint: [lib/tools/run-tool.js](lib/tools/run-tool.js) routes to a single tool handler.
- Tool handlers: [lib/tools](lib/tools)
  - read_file -> [lib/tools/read-file.js](lib/tools/read-file.js)
  - list_files -> [lib/tools/list-files.js](lib/tools/list-files.js)
  - search_files -> [lib/tools/search-files.js](lib/tools/search-files.js)
  - write_to_file -> [lib/tools/write-to-file.js](lib/tools/write-to-file.js)
  - apply_diff -> [lib/tools/apply-diff.js](lib/tools/apply-diff.js)
  - search_and_replace -> [lib/tools/search-and-replace.js](lib/tools/search-and-replace.js)
  - insert_content -> [lib/tools/insert-content.js](lib/tools/insert-content.js)
  - list_code_definition_names -> [lib/tools/list-code-definition-names.js](lib/tools/list-code-definition-names.js)
  - update_todo_list -> [lib/tools/update-todo-list.js](lib/tools/update-todo-list.js)

## Tool build + flow

1. The system prompt is assembled from [prompts/coder.txt](prompts/coder.txt) and runtime context.
2. Raw request/response payloads are logged per task; system prompt content is hidden in the log UI.
3. The assistant output is parsed for a tool call, then routed through [lib/tools/index.js](lib/tools/index.js).
4. Only read/write/execute pause for approval; other tools auto-approve.
5. Tool results are persisted in history as raw text but displayed in readable form; thinking blocks are expandable.
## Launch in a new VS Code window

```bash
npm install
npm run verify
```

`npm run verify` launches an Extension Development Host window using this extension.

## Where to find the UI

In the new window:
- Open the Activity Bar item **Sarvam**.
- Open the **Sarvam Coder** view.

The view includes:
- Left assistant chat area and input
- Settings fields: Base URL, API Key, Model, Context Window Size
- History with search
- Auto-approve showing only Read/Write/Execute

## Policy behavior in extension host

- Fixed system prompt is applied for each request. Available in prompts/coder.txt.
- Runtime context is collected each request:
  - OS and shell
  - Workspace root
  - Project metadata and relevant structure
- Query-driven search runs for find/locate/search/inspect requests.
- Before any write attempt, a checkpoint is created automatically.
- Writes use patch-style targeted edits.
- History tracks write attempts with checkpoint IDs.

## Checkpoint location

`.sarvam/checkpoints/<timestamp>-<request-id>.json`

Checkpoint content:
- Timestamp
- Request ID
- Target file list
- Pre-change snapshot
- Planned patch diff
