import { useState } from "react";
import { promptFor, runnable, type Book } from "@/island/shortcuts";
import { Markdown } from "@/Markdown";

/// What the last shortcut run came to.
export type Ran = { name: string; outcome: "done" | "failed" | "unjudged"; answer: string };

type Props = {
  books: Book[];
  /// The shortcut running now, if one is: one at a time, as in the chat.
  running: string | null;
  ran: Ran | null;
  trouble: string | null;
  onRun: (name: string, text: string) => void;
  /// The keyboard is wanted, and then no longer.
  onReach: () => void;
  onLeave: () => void;
};

/// Playbooks chosen in settings, run from the notch: one that needs nothing runs at a press, one
/// that needs a word asks for it in a box like the chat's, and what the run came to shows below.
export function Shortcuts({ books, running, ran, trouble, onRun, onReach, onLeave }: Props) {
  const [asking, setAsking] = useState<Book | null>(null);
  const [typed, setTyped] = useState("");

  // The box going away takes no blur with it, so the keyboard is handed back here as it goes.
  const press = (book: Book) => {
    if (runnable(book) === "now") {
      if (asking) onLeave();
      setAsking(null);
      onRun(book.name, "");
      return;
    }
    onReach();
    setAsking(book);
  };

  return (
    <div className="view shortcuts">
      {books.length === 0 ? (
        <p className="empty">Choose playbooks for the notch in System, under playbooks.</p>
      ) : (
        <div className="keys">
          {books.map((book) => {
            const how = runnable(book);
            const doing = running === book.name;
            return (
              <button
                type="button"
                key={book.name}
                className={doing ? "key running" : asking?.name === book.name ? "key asking" : "key"}
                disabled={running !== null || how === "elsewhere"}
                title={how === "elsewhere" ? "needs more than one answer, so it runs from the chat" : book.when}
                onClick={() => press(book)}
              >
                <strong>{book.name}</strong>
                <span>{doing ? "running…" : how === "now" ? "runs at a press" : how === "asks" ? `asks for ${book.inputs[0]?.name ?? "a word"}` : "from the chat"}</span>
              </button>
            );
          })}
        </div>
      )}
      {asking ? (
        <div className="foot">
          <input
            className="composer"
            autoFocus
            value={typed}
            placeholder={promptFor(asking)}
            spellCheck={false}
            onPointerDown={onReach}
            onBlur={onLeave}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && typed.trim() !== "" && running === null) {
                onRun(asking.name, typed.trim());
                setTyped("");
                setAsking(null);
                onLeave();
              }
            }}
          />
        </div>
      ) : ran ? (
        <div className={ran.outcome === "failed" ? "ran failed" : "ran"}>
          <Markdown text={ran.answer} />
        </div>
      ) : null}
      {trouble ? <p className="said trouble">{trouble}</p> : null}
    </div>
  );
}
