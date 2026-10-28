import { useState } from "react";
import { dueOf, missingSaid, priorityOf, PRIORITIES, type Todo } from "@/island/todos";
import { useKeyboard } from "@/island/useKeyboard";
import type { TodoList } from "@/island/useTodos";
import { TodoEditor } from "@/island/views/TodoEditor";

type Props = {
  list: TodoList;
  now: number;
  onReach: () => void;
  onLeave: () => void;
};

/// As long as Notion keeps a todo's words and its note here.
const WORDS = 200;
const NOTE = 2_000;

const BOX = "M3.5 3.5h9v9h-9z";
const TICKED = "M3.5 3.5h9v9h-9z M5.6 8.2l1.7 1.7 3.2-3.6";
const MORE = "M3 4h10v9.5H3z M3 7h10 M5.5 2.5v3 M10.5 2.5v3";
const EDIT = "M3.2 12.8l.9-3.3 6.6-6.6 2.4 2.4-6.6 6.6-3.3.9z M9.4 4.2l2.4 2.4";

function Glyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const EMPTY = { text: "", date: "", time: "", priority: "", note: "" };

/// The todos kept in the Notion database chosen for them: added by typing, with a date, a time, a
/// priority and a note to hand, and ticked off there. A todo's words open it in Notion.
export function Todos({ list, now, onReach, onLeave }: Props) {
  const [typed, setTyped] = useState(EMPTY);
  const [details, setDetails] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const keyboard = useKeyboard(onReach, onLeave);

  const listed = list.listed;
  if (!listed) return <div className="view todos"><p className="empty">Reading the todos…</p></div>;
  if (listed.missing) return <div className="view todos"><p className="empty">{list.trouble ?? missingSaid(listed.missing)}</p></div>;

  const fields = listed.fields ?? { date: false, priority: false, done: false };
  const open = listed.todos.filter((one) => !list.ticked.some((ticked) => ticked.id === one.id));
  const add = () => {
    if (typed.text.trim() === "") return;
    void list.add({ ...typed, time: typed.date ? typed.time : "" }).then((kept) => {
      if (!kept) return;
      setTyped(EMPTY);
      setDetails(false);
    });
  };
  const row = (one: Todo, done: boolean) => {
    if (one.id === editing && !done) {
      return <TodoEditor key={one.id} todo={one} fields={fields} onSave={(changes) => list.edit(one, changes)} onDone={() => setEditing(null)} onReach={onReach} onLeave={onLeave} />;
    }
    const due = dueOf(one.due, now);
    const priority = priorityOf(one.priority);
    return (
      <li key={one.id} className={done ? "todo done" : "todo"}>
        <button type="button" className="tick" aria-pressed={done} title={done ? "not done after all" : "done"} disabled={!fields.done} onClick={() => list.tick(one, !done)}>
          <Glyph path={done ? TICKED : BOX} />
        </button>
        <button type="button" className="text" title={one.url ? "open in Notion" : one.text} onClick={() => one.url && list.open(one.url)}>
          {one.text}
        </button>
        {one.priority ? <span className={`priority ${priority ?? ""}`}>{one.priority}</span> : null}
        {due ? <span className={due.overdue && !done ? "due overdue" : "due"}>{due.said}</span> : null}
        {done ? null : (
          <button type="button" className="edit" title="edit" onClick={() => setEditing(one.id)}>
            <Glyph path={EDIT} />
          </button>
        )}
      </li>
    );
  };

  return (
    <div className="view todos">
      <div className="adding" data-keeps-keyboard>
        <div className="line">
          <input
            className="composer"
            value={typed.text}
            maxLength={WORDS}
            spellCheck={false}
            placeholder={`add a todo to ${listed.database ?? "Notion"}`}
            {...keyboard}
            onChange={(event) => setTyped((was) => ({ ...was, text: event.target.value }))}
            onKeyDown={(event) => event.key === "Enter" && add()}
          />
          <button type="button" className={details ? "more on" : "more"} title="a date, a time, a priority or a note" onClick={() => setDetails((was) => !was)}>
            <Glyph path={MORE} />
          </button>
        </div>
        {details ? (
          <div className="details">
            {fields.date ? (
              <>
                <input type="date" aria-label="due date" value={typed.date} {...keyboard} onChange={(event) => setTyped((was) => ({ ...was, date: event.target.value }))} />
                <input type="time" aria-label="due time" value={typed.time} disabled={!typed.date} {...keyboard} onChange={(event) => setTyped((was) => ({ ...was, time: event.target.value }))} />
              </>
            ) : null}
            {fields.priority ? (
              <select aria-label="priority" value={typed.priority} {...keyboard} onChange={(event) => setTyped((was) => ({ ...was, priority: event.target.value }))}>
                <option value="">no priority</option>
                {PRIORITIES.map((one) => (
                  <option key={one} value={one}>
                    {one}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              className="note"
              aria-label="note"
              placeholder="a note"
              maxLength={NOTE}
              spellCheck={false}
              value={typed.note}
              {...keyboard}
              onChange={(event) => setTyped((was) => ({ ...was, note: event.target.value }))}
              onKeyDown={(event) => event.key === "Enter" && add()}
            />
          </div>
        ) : null}
      </div>
      {open.length + list.ticked.length === 0 ? (
        <p className="empty">Nothing left to do in {listed.database ?? "Notion"}.</p>
      ) : (
        <ul className="list">
          {open.map((one) => row(one, false))}
          {list.ticked.map((one) => row(one, true))}
        </ul>
      )}
      <p className="foot">
        {list.trouble ? <span className="trouble">{list.trouble}</span> : <span className="left">{open.length === 0 ? "nothing left" : `${open.length} left`}</span>}
        <span className="where">{listed.database}</span>
      </p>
    </div>
  );
}
