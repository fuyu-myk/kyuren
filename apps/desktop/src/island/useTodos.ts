import { useCallback, useEffect, useState } from "react";
import { command, on } from "@/island/channels";
import type { Todo } from "@/island/todos";

export type TodoList = ReturnType<typeof useTodos>;

/// The todo list, as the host keeps it in Kyuren's own folder, and the changes made to it here.
/// Each change answers with the list as it now stands; one refused says why.
export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [trouble, setTrouble] = useState<string | null>(null);

  useEffect(() => {
    const stop = on<Todo[]>("todos:changed", setTodos);
    void command<Todo[]>("todos_list").then((kept) => kept && setTodos(kept), (failure) => setTrouble(String(failure)));
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  const settled = useCallback(
    (asked: Promise<Todo[] | undefined>): Promise<boolean> =>
      asked.then(
        (kept) => {
          setTrouble(null);
          if (kept) setTodos(kept);
          return true;
        },
        (failure) => {
          setTrouble(String(failure));
          return false;
        },
      ),
    [],
  );

  return {
    todos,
    trouble,
    add: (text: string) => settled(command<Todo[]>("todos_add", { text })),
    tick: (id: string, done: boolean) => void settled(command<Todo[]>("todos_tick", { id, done })),
    remove: (id: string) => void settled(command<Todo[]>("todos_remove", { id })),
    clear: () => void settled(command<Todo[]>("todos_clear")),
  };
}
