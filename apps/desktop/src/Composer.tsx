import { useCallback, useEffect, useRef, useState } from "react";
import { stepped, suggest, type Command } from "@/commands";

type ComposerProps = {
  placeholder: string;
  busy: boolean;
  onSend: (text: string) => void;
  /// Stops what is being waited on, offered in place of sending while busy.
  onStop?: () => void;
  /// What a slash may be followed by. With any given, typing a slash opens the menu.
  commands?: Command[];
};

/// The bar at the bottom of every page. It grows upwards as it fills, stops growing once it would
/// take over the page, and scrolls from then on.
export function Composer({ placeholder, busy, onSend, onStop, commands }: ComposerProps) {
  const [text, setText] = useState("");
  const [scrolling, setScrolling] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const settling = useRef<number>(0);

  // Measured from nothing each time, or it could only ever grow.
  const grow = useCallback(() => {
    const here = box.current;
    if (!here) return;
    here.style.height = "auto";
    here.style.height = `${here.scrollHeight}px`;
  }, []);

  useEffect(() => {
    grow();
    // Measured again on the next frame. The first measurement can happen before the styles that
    // decide how tall a line is have landed, and a bar measured then keeps the wrong size.
    const again = requestAnimationFrame(grow);
    return () => cancelAnimationFrame(again);
  }, [text, grow]);

  useEffect(() => {
    window.addEventListener("resize", grow);
    return () => window.removeEventListener("resize", grow);
  }, [grow]);

  useEffect(() => () => window.clearTimeout(settling.current), []);

  // Typing again after escape brings the menu back, and every change starts from the top of it.
  useEffect(() => {
    setHighlight(0);
    setDismissed(false);
  }, [text]);

  const menu = dismissed ? [] : suggest(commands ?? [], text);

  function pick(one: Command): void {
    setText(`/${one.name} `);
    box.current?.focus();
  }

  function send(): void {
    const saying = text.trim();
    if (saying === "" || busy) return;
    setText("");
    onSend(saying);
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        ref={box}
        className={scrolling ? "scrolling" : ""}
        value={text}
        rows={1}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setText(event.target.value)}
        onScroll={() => {
          // The scrollbar is shown only while it is being used, so a still page has nothing on it
          // that is not part of the page.
          setScrolling(true);
          window.clearTimeout(settling.current);
          settling.current = window.setTimeout(() => setScrolling(false), 900);
        }}
        onKeyDown={(event) => {
          if (menu.length > 0) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight((was) => stepped(was, event.key === "ArrowDown" ? 1 : -1, menu.length));
              return;
            }
            if (event.key === "Tab" || event.key === "Enter") {
              event.preventDefault();
              const chosen = menu[highlight];
              if (chosen) pick(chosen);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDismissed(true);
              return;
            }
          }
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            send();
          }
        }}
      />
      {menu.length > 0 ? (
        <ul className="suggest" role="listbox" aria-label="commands">
          {menu.map((one, at) => (
            <li
              key={`${one.kind}-${one.name}`}
              role="option"
              aria-selected={at === highlight}
              className={at === highlight ? "lit" : ""}
              onMouseDown={(event) => {
                // Picked on mouse down, before the bar loses focus to the click.
                event.preventDefault();
                pick(one);
              }}
            >
              <span className="name">/{one.name}</span>
              <span className="about">{one.about}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {busy && onStop ? (
        <button className="send stop" type="button" onClick={onStop} aria-label="stop">
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <button className="send" type="submit" disabled={busy || text.trim() === ""} aria-label="send">
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              d="M13 3.5v4A2.5 2.5 0 0 1 10.5 10H4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M6.5 7.5 4 10l2.5 2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </form>
  );
}
