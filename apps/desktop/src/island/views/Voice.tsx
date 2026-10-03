import { useState } from "react";
import type { Voice as Speaking } from "@/island/channels";
import type { Bubble } from "@/island/thread";
import { Bubbles } from "@/island/views/Bubbles";

type Props = {
  /// A chat has started, so the conversation shows where the icosahedron stood.
  chatting: boolean;
  bubbles: Bubble[];
  voice: Speaking;
  asking: boolean;
  onAsk: (prompt: string) => void;
  /// The keyboard is wanted, and then no longer.
  onReach: () => void;
  onLeave: () => void;
};

/// The icosahedron's tab: it stands above the composer until a chat starts, with what is being
/// heard written under it, and then the chat takes its place.
export function Voice({ chatting, bubbles, voice, asking, onAsk, onReach, onLeave }: Props) {
  const [typed, setTyped] = useState("");
  const last = bubbles[bubbles.length - 1];
  const hearing = last && last.who === "you" && last.live ? last.text : "";

  return (
    <div className="view voice">
      <div className="stage">
        {chatting ? (
          <Bubbles bubbles={bubbles} waiting={asking || voice === "thinking"} />
        ) : (
          <p className="caption">{hearing}</p>
        )}
      </div>
      <div className="foot">
        <input
          className="composer"
          value={typed}
          placeholder="ask Kyuren"
          spellCheck={false}
          onPointerDown={onReach}
          onBlur={onLeave}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            // One question at a time: an answer still coming would land in the next one's place.
            if (event.key === "Enter" && typed.trim() !== "" && !asking) {
              onAsk(typed.trim());
              setTyped("");
            }
          }}
        />
      </div>
    </div>
  );
}
