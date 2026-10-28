import { useState, type KeyboardEvent } from "react";
import { changesOf, formOf, PRIORITIES, type Form, type Listed, type Todo } from "@/island/todos";
import { useKeyboard } from "@/island/useKeyboard";

type Props = {
  todo: Todo;
  fields: NonNullable<Listed["fields"]>;
  onSave: (changes: Partial<Form>) => Promise<boolean>;
  onDone: () => void;
  onReach: () => void;
  onLeave: () => void;
};

/// A todo's words, when it is due and its priority, changed where it stands: return or save keeps
/// what changed, and escape or cancel leaves it as it was.
export function TodoEditor({ todo, fields, onSave, onDone, onReach, onLeave }: Props) {
  const [form, setForm] = useState(() => formOf(todo));
  const keyboard = useKeyboard(onReach, onLeave);

  const save = () => {
    if (form.text.trim() === "") return;
    const changes = changesOf(todo, form);
    if (Object.keys(changes).length === 0) {
      onDone();
      return;
    }
    void onSave(changes).then((kept) => kept && onDone());
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter") save();
    // Escape here leaves the edit, not the island.
    if (event.key === "Escape") {
      event.stopPropagation();
      onDone();
    }
  };
  const set = (change: Partial<Form>) => setForm((was) => ({ ...was, ...change }));

  return (
    <li className="todo editing" data-keeps-keyboard>
      <input className="words" aria-label="todo" autoFocus maxLength={200} spellCheck={false} value={form.text} {...keyboard} onKeyDown={keys} onChange={(event) => set({ text: event.target.value })} />
      {fields.date ? (
        <>
          <input type="date" aria-label="due date" value={form.date} {...keyboard} onKeyDown={keys} onChange={(event) => set({ date: event.target.value })} />
          <input type="time" aria-label="due time" value={form.time} disabled={!form.date} {...keyboard} onKeyDown={keys} onChange={(event) => set({ time: event.target.value })} />
        </>
      ) : null}
      {fields.priority ? (
        <select aria-label="priority" value={form.priority} {...keyboard} onKeyDown={keys} onChange={(event) => set({ priority: event.target.value })}>
          <option value="">no priority</option>
          {PRIORITIES.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
      ) : null}
      <button type="button" className="save" onClick={save}>
        save
      </button>
      <button type="button" className="cancel" onClick={onDone}>
        cancel
      </button>
    </li>
  );
}
