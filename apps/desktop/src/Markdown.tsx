import { Fragment, type ReactNode } from "react";
import { openLink } from "@/links";
import { blocks, type Piece } from "@/prose";

function shown(pieces: Piece[], addresses: boolean): ReactNode[] {
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
        <Fragment key={key}>
          <a
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
          {addresses && piece.text.trim() !== piece.href ? <span className="address"> ({piece.href})</span> : null}
        </Fragment>
      );
    }
    return <span key={key}>{piece.text}</span>;
  });
}

/// Text in Markdown, drawn. With addresses, each link says where it leads beside it, for text whose
/// links matter before they are clicked, such as a plan to approve.
export function Markdown({ text, addresses = false }: { text: string; addresses?: boolean }) {
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
          return <Level key={key}>{shown(block.pieces, addresses)}</Level>;
        }
        if (block.kind === "list") {
          const items = block.items.map((pieces, item) => <li key={item}>{shown(pieces, addresses)}</li>);
          return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
        }
        if (block.kind === "quote") {
          return <blockquote key={key}>{shown(block.pieces, addresses)}</blockquote>;
        }
        return <p key={key}>{shown(block.pieces, addresses)}</p>;
      })}
    </div>
  );
}
