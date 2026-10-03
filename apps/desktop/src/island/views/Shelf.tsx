import { useRef } from "react";
import { held, nameFor, sizeOf, type Shelved } from "@/island/shelf";

type Props = {
  items: Shelved[];
  /// Something is being carried over the island now.
  carrying: boolean;
  /// What was dropped is being copied in.
  keeping: boolean;
  trouble: string | null;
  onDrag: (id: string, copying: boolean) => void;
  onRemove: (id: string) => void;
  onReveal: (id: string) => void;
};

const REVEAL = "M7 3.5H4a1 1 0 0 0-1 1V12a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1V9 M9.5 2.5h4v4 M13.5 2.5 7.5 8.5";
const REMOVE = "M4.5 4.5l7 7 M11.5 4.5l-7 7";

function Glyph({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/// Files kept for later: dropped on the notch, and dragged out again into Finder or a message.
export function Shelf({ items, carrying, keeping, trouble, onDrag, onRemove, onReveal }: Props) {
  const pressed = useRef<{ id: string; x: number; y: number } | null>(null);
  const said = trouble ?? (keeping ? "Keeping it…" : items.length > 0 ? "Each stays where it is until dragged out: drag to move it there, or hold option to copy it." : "");

  return (
    <div className={carrying ? "view shelf carrying" : "view shelf"}>
      {items.length === 0 ? (
        <p className="empty">{carrying ? "Drop it to hold it here." : "Drop files on the notch to hold them here, then drag them out to wherever they go."}</p>
      ) : (
        <div className="tiles">
          {items.map((one) => (
            <div
              key={one.id}
              className="tile"
              title={one.name}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                pressed.current = { id: one.id, x: event.clientX, y: event.clientY };
              }}
              onPointerMove={(event) => {
                const from = pressed.current;
                if (from?.id !== one.id || !held(from, { x: event.clientX, y: event.clientY, buttons: event.buttons })) return;
                // The drag is the system's from here, and this press never sees its release.
                pressed.current = null;
                onDrag(one.id, event.altKey);
              }}
              onPointerUp={() => {
                pressed.current = null;
              }}
              onPointerCancel={() => {
                pressed.current = null;
              }}
            >
              {one.icon ? <img src={one.icon} alt="" draggable={false} /> : <span className="blank" />}
              <span className="name">{nameFor(one.name, 24)}</span>
              <span className="size">{one.folder ? "folder" : sizeOf(one.size)}</span>
              <span className="actions">
                <button type="button" title="Show in Finder" onPointerDown={(event) => event.stopPropagation()} onClick={() => onReveal(one.id)}>
                  <Glyph path={REVEAL} />
                </button>
                <button type="button" title="Take off the shelf" onPointerDown={(event) => event.stopPropagation()} onClick={() => onRemove(one.id)}>
                  <Glyph path={REMOVE} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {/* Kept out when there is nothing to say, so an empty shelf's words sit at the middle as every
          other page's do. */}
      {said ? <p className={trouble ? "said trouble" : "said"}>{said}</p> : null}
    </div>
  );
}
