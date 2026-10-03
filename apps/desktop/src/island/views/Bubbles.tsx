import { useEffect, useRef } from "react";
import type { Bubble } from "@/island/thread";
import { Markdown } from "@/Markdown";

type Props = {
  bubbles: Bubble[];
  /// An answer is being worked on, so an empty reply shows that it is coming.
  waiting: boolean;
};

/// The conversation as messages: yours on the right, Kyuren's on the left, newest at the foot.
export function Bubbles({ bubbles, waiting }: Props) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = list.current;
    if (at) at.scrollTop = at.scrollHeight;
  }, [bubbles, waiting]);

  return (
    <div ref={list} className="bubbles">
      {bubbles.map((one) => {
        if (one.who === "kyuren" && one.live && one.text === "") {
          return waiting ? (
            <div key={one.id} className="bubble kyuren coming" aria-label="Kyuren is answering">
              <i />
              <i />
              <i />
            </div>
          ) : null;
        }
        const kind = ["bubble", one.who, one.live ? "live" : "", one.failed ? "failed" : ""].filter(Boolean).join(" ");
        // An answer keeps the shape it was written in; what was said is shown as it was said.
        if (one.who === "kyuren" && !one.failed) {
          return (
            <div key={one.id} className={kind}>
              <Markdown text={one.text} />
            </div>
          );
        }
        return (
          <p key={one.id} className={kind}>
            {one.text}
          </p>
        );
      })}
    </div>
  );
}
