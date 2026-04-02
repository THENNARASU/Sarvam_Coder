const runUpdateTodoList = (args) => {
  const todos = args.todos ? args.todos.join("\n").trim() : "";
  return `Todo list updated:\n${todos}`;
};

module.exports = runUpdateTodoList;
