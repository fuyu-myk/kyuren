import type { ReactNode } from "react";
import { openLink } from "@/links";
import { blocks, type Piece } from "@/prose";

function shown(pieces: Piece[]): ReactNode[] {
  return pieces.map((piece, at) => {
    const key = `${piece.kind}-${at}`;
    if (piece.kind === "code") return <code key={key}>{piece.text}</code>;
    if (piece.kind === "strong") return <strong key={key}>{piece.text}</strong>;
    if (piece.kind === "emphasis") return <em key={key}>{piece.text}</em>;
    // Followed in the user's own browser, never here: a window that navigates away from itself
    // when an answer is clicked has lost the conversation. A link whose text is a number is a
    // citation, and reads as one.
    if (piece.kind === "link") {
      const cite = /^\d+$/.test(piece.text.trim());
      return (
        <a
          key={key}
          href={piece.href}
          className={cite ? "link cite" : "link"}
          title={piece.href}
          onClick={(event) => {
            event.preventDefault();
            void openLink(piece.href);
          }}
        >
          {cite ? `[${piece.text.trim()}]` : piece.text}
        </a>
      );
    }
    return <span key={key}>{piece.text}</span>;
  });
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose">
      {blocks(text).map((block, at) => {
        const key = `${block.kind}-${at}`;
        if (block.kind === "code") {
          return (
            <pre key={key}>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "heading") {
          const Level = `h${Math.min(block.level + 2, 6)}` as "h3";
          return <Level key={key}>{shown(block.pieces)}</Level>;
        }
        if (block.kind === "list") {
          const items = block.items.map((pieces, item) => <li key={item}>{shown(pieces)}</li>);
          return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
        }
        if (block.kind === "quote") {
          return <blockquote key={key}>{shown(block.pieces)}</blockquote>;
        }
        return <p key={key}>{shown(block.pieces)}</p>;
      })}
    </div>
  );
}
