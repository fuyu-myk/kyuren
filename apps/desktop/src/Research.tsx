import { useEffect, useState } from "react";
import { Markdown } from "@/Markdown";
import { readResearch, researchNotes, type Note } from "@/findings";

type Props = { refresh: number };

/// What research has produced: the notes in the vault's research folder, and any one of them read
/// in place.
export function Research({ refresh }: Props) {
  const [notes, setNotes] = useState<Note[]>();
  const [open, setOpen] = useState<{ slug: string; text: string }>();

  useEffect(() => {
    void researchNotes().then(setNotes).catch(() => setNotes([]));
  }, [refresh]);

  if (open) {
    return (
      <section>
        <div className="actions">
          <button type="button" className="ghost" onClick={() => setOpen(undefined)}>
            back to the notes
          </button>
        </div>
        <Markdown text={open.text} />
      </section>
    );
  }

  return (
    <section>
      <h3>research notes</h3>
      {notes === undefined ? (
        <p className="hint">asking</p>
      ) : notes.length === 0 ? (
        <p className="hint">nothing researched yet; type a question, or /research followed by one</p>
      ) : (
        <ul className="rows">
          {notes.map((one) => (
            <li key={one.slug} className="row">
              <span className="dot" />
              <span className="label">{one.at.slice(0, 10)}</span>
              <span className="detail">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => void readResearch(one.slug).then((text) => setOpen({ slug: one.slug, text }))}
                >
                  {one.title}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
