/// The conversation on the island's voice tab as message bubbles: what was said, typed or heard,
/// and what came back, streamed in as it is written.

/// How a question was asked, which is how its answer finds its own bubble.
export type Asked = "typed" | "spoken";

export type Bubble = {
  id: number;
  who: "you" | "kyuren";
  text: string;
  live: boolean;
  failed?: boolean;
  /// For an answer, how the question it answers was asked.
  asked?: Asked;
};

export type Thread = { bubbles: Bubble[]; next: number; session?: string };

export type Said =
  | { type: "typed"; text: string }
  | { type: "heard"; text: string; final: boolean }
  | { type: "chunk"; text: string }
  | { type: "replied"; text: string; asked: Asked; session?: string }
  | { type: "failed"; reason: string; asked: Asked }
  | { type: "cleared" };

/// Enough to scroll back through; a typed conversation is also kept whole in the main window.
export const KEPT = 60;

export const EMPTY: Thread = { bubbles: [], next: 1 };

function added(t: Thread, bubble: Omit<Bubble, "id">): Thread {
  return { ...t, bubbles: [...t.bubbles, { id: t.next, ...bubble }].slice(-KEPT), next: t.next + 1 };
}

function lastLive(t: Thread, fits: (one: Bubble) => boolean): number {
  for (let at = t.bubbles.length - 1; at >= 0; at -= 1) {
    const one = t.bubbles[at]!;
    if (one.live && fits(one)) return at;
  }
  return -1;
}

function changed(t: Thread, at: number, change: Partial<Bubble>): Thread {
  return { ...t, bubbles: t.bubbles.map((one, here) => (here === at ? { ...one, ...change } : one)) };
}

const answer = (one: Bubble) => one.who === "kyuren";
const answering = (asked: Asked) => (one: Bubble) => one.who === "kyuren" && one.asked === asked;
const hearing = (one: Bubble) => one.who === "you";

/// A new question abandons the answer still coming to the one before it, as the core abandons
/// that turn: what came of it is kept, and an empty one goes.
function settled(t: Thread): Thread {
  const at = lastLive(t, answer);
  if (at < 0) return t;
  return t.bubbles[at]!.text === "" ? { ...t, bubbles: t.bubbles.filter((_, here) => here !== at) } : changed(t, at, { live: false });
}

export function said(t: Thread, e: Said): Thread {
  switch (e.type) {
    case "typed":
      return added(added(settled(t), { who: "you", text: e.text, live: false }), { who: "kyuren", text: "", live: true, asked: "typed" });

    case "heard": {
      // Words show as they are heard, after any answer still coming. Only a finished sentence is
      // a new question; a cough or a half-started one is not, and takes no answer away.
      const at = lastLive(t, hearing);
      const room = at >= 0 ? t : added(t, { who: "you", text: "", live: true });
      const heard = changed(room, at >= 0 ? at : room.bubbles.length - 1, { text: e.text, live: !e.final });
      return e.final ? added(settled(heard), { who: "kyuren", text: "", live: true, asked: "spoken" }) : heard;
    }

    case "chunk": {
      const at = lastLive(t, answer);
      return at < 0 ? t : changed(t, at, { text: t.bubbles[at]!.text + e.text });
    }

    case "replied": {
      const carried = e.session ? { ...t, session: e.session } : t;
      const at = lastLive(carried, answering(e.asked));
      return at < 0 ? carried : changed(carried, at, { text: e.text, live: false });
    }

    case "failed": {
      const at = lastLive(t, answering(e.asked));
      return at < 0 ? t : changed(t, at, { text: e.reason, live: false, failed: true });
    }

    case "cleared":
      return { bubbles: [], next: t.next };
  }
}
