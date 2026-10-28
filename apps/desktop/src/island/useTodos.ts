import { useCallback, useEffect, useState } from "react";
import { command, on } from "@/island/channels";
import type { Adding, Form, Listed, Todo } from "@/island/todos";

export type TodoList = ReturnType<typeof useTodos>;

/// The todo list as it is kept in Notion, read again whenever the page shows, added to, edited and
/// ticked off from the island. A todo ticked off here stays below the list, struck through, so it
/// can be ticked back on, until the page is left.
export function useTodos(shown: boolean) {
  const [listed, setListed] = useState<Listed | null>(null);
  const [ticked, setTicked] = useState<Todo[]>([]);
  const [trouble, setTrouble] = useState<string | null>(null);

  useEffect(() => {
    const stop = on<Listed>("todos:changed", setListed);
    return () => void stop.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    if (!shown) {
      setTicked([]);
      return;
    }
    void command<Listed>("todos_list").then((read) => read && setListed(read), (failure) => setTrouble(String(failure)));
  }, [shown]);

  const settled = useCallback(
    (asked: Promise<Listed | undefined>): Promise<boolean> =>
      asked.then(
        (read) => {
          setTrouble(null);
          if (read) setListed(read);
          return true;
        },
        (failure) => {
          setTrouble(String(failure));
          return false;
        },
      ),
    [],
  );

  const add = (adding: Adding) => settled(command<Listed>("todos_add", adding));
  const edit = (todo: Todo, changes: Partial<Form>) => settled(command<Listed>("todos_edit", { id: todo.id, ...changes }));
  const tick = (todo: Todo, done: boolean) => {
    setTicked((was) => (done ? [...was.filter((one) => one.id !== todo.id), { ...todo, done: true }] : was.filter((one) => one.id !== todo.id)));
    void settled(command<Listed>("todos_tick", { id: todo.id, done }));
  };
  const open = (url: string) => void command("open_link", { url }).catch((failure) => setTrouble(String(failure)));

  return { listed, ticked, trouble, add, edit, tick, open };
}
