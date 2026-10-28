/// A todo as the host keeps it.
export type Todo = { id: string; text: string; done: boolean; at: number };

/// What is left to do first, in the order it was added, then what is done.
export function ordered(todos: Todo[]): Todo[] {
  return [...todos.filter((one) => !one.done), ...todos.filter((one) => one.done)];
}
