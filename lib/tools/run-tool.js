const runReadFile = require("./read-file");
const runListFiles = require("./list-files");
const runSearchFiles = require("./search-files");
const runWriteFile = require("./write-to-file");
const runApplyDiff = require("./apply-diff");
const runSearchAndReplace = require("./search-and-replace");
const runInsertContent = require("./insert-content");
const runListCodeDefinitionNames = require("./list-code-definition-names");
const runUpdateTodoList = require("./update-todo-list");

const runTool = async (workspaceFolder, toolCall) => {
  switch (toolCall.name) {
    case "read_file":
      return runReadFile(workspaceFolder, toolCall.args);
    case "list_files":
      return runListFiles(workspaceFolder, toolCall.args);
    case "search_files":
      return runSearchFiles(workspaceFolder, toolCall.args);
    case "write_to_file":
      return runWriteFile(workspaceFolder, toolCall.args);
    case "apply_diff":
      return runApplyDiff(workspaceFolder, toolCall.args);
    case "search_and_replace":
      return runSearchAndReplace(workspaceFolder, toolCall.args);
    case "insert_content":
      return runInsertContent(workspaceFolder, toolCall.args);
    case "list_code_definition_names":
      return runListCodeDefinitionNames(workspaceFolder, toolCall.args);
    case "update_todo_list":
      return runUpdateTodoList(toolCall.args);
    default:
      return `Tool not supported: ${toolCall.name}`;
  }
};

module.exports = {
  runTool
};
