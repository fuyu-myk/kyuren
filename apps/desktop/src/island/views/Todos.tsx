import { useEffect, useRef, useState } from "react";
import { ordered } from "@/island/todos";
import type { TodoList } from "@/island/useTodos";

type Props = {
  list: TodoList;
  onReach: () => void;
  onLeave: () => void;
};

/// As long as the host keeps one.
const LONGEST = 200;

const BOX = "M3.5 3.5h9v9h-9z";
const TICKED = "M3.5 3.5h9v9h-9z M5.6 8.2l1.7 1.7 3.2-3.6";
const REMOVE = "M4.5 4.5l7 7 M11.5 4.5l-7 7";

function Glyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/// A list of its own: added by typing, ticked off, and taken off one at a time or all that is done.
export function Todos({ list, onReach, onLeave }: Props) {
  const { todos, trouble } = list;
  const [typed, setTyped] = useState("");
  // Taken away while typed into, the box gives back the keyboard it was holding.
  const holding = useRef<(() => void) | null>(null);
  useEffect(() => () => holding.current?.(), []);

  const done = todos.filter((one) => one.done).length;
  const left = todos.length - done;

  return (
    <div className="view todos">
      <input
        className="composer todo"
        value={typed}
        maxLength={LONGEST}
        spellCheck={false}
        placeholder="add a todo"
        onPointerDown={onReach}
        onFocus={() => {
          holding.current = onLeave;
          onReach();
        }}
        onBlur={() => {
          holding.current = null;
          onLeave();
        }}
        onChange={(event) => setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || typed.trim() === "") return;
          void list.add(typed).then((kept) => kept && setTyped(""));
        }}
      />
      {todos.length === 0 ? (
        <p className="empty">Nothing to do yet: type one above and press return.</p>
      ) : (
        <ul className="list">
          {ordered(todos).map((one) => (
            <li key={one.id} className={one.done ? "todo done" : "todo"}>
              <button type="button" className="tick" aria-pressed={one.done} title={one.done ? "not done after all" : "done"} onClick={() => list.tick(one.id, !one.done)}>
                <Glyph path={one.done ? TICKED : BOX} />
              </button>
              <span className="text">{one.text}</span>
              <button type="button" className="remove" title="take off the list" onClick={() => list.remove(one.id)}>
                <Glyph path={REMOVE} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="foot">
        {trouble ? <span className="trouble">{trouble}</span> : <span className="left">{left === 0 ? "nothing left" : `${left} left`}</span>}
        {done > 0 ? (
          <button type="button" className="clear" onClick={list.clear}>
            clear {done} done
          </button>
        ) : null}
      </p>
    </div>
  );
}
