import { useEffect, useState } from "react";
import { command, on } from "@/island/channels";
import type { Playing } from "@/island/glance";

export type Visualizing = {
  on: boolean;
  /// Why the player could not be heard, when it could not.
  trouble: string | null;
  toggle: () => void;
};

/// Hearing is started and stopped in the order asked, each waiting on the one before, so the quiet
/// meant for one player can never land after the listen for the next.
let hearing: Promise<unknown> = Promise.resolve();

function hear(player: string | null): Promise<unknown> {
  const next = hearing.then(() => command("music_hear", player ? { player } : {}));
  hearing = next.catch(() => undefined);
  return next;
}

/// Whether the music widget draws what plays, and the player heard for it only while the widget is
/// in sight with the visualizer on and something playing, so nothing is heard for nothing.
export function useVisualizer(shown: boolean, playing: Playing | null): Visualizing {
  const [drawing, setDrawing] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);

  useEffect(() => {
    void command<boolean>("island_visualizer").then((set) => set !== undefined && setDrawing(set));
    const listening = [
      on<boolean>("island:visualizer", setDrawing),
      on<{ reason: string }>("music:hear-trouble", (heard) => setTrouble(heard.reason)),
    ];
    return () => listening.forEach((unlisten) => void unlisten.then((stop) => stop()));
  }, []);

  const player = shown && drawing && playing?.playing ? playing.player : null;
  useEffect(() => {
    setTrouble(null);
    // A quiet is sent even when nothing was heard here, since a page loaded afresh cannot know
    // what the one before it left running.
    void hear(player).catch((failure) => {
      if (player) setTrouble(String(failure));
    });
  }, [player]);
  useEffect(() => () => void hear(null), []);

  return {
    on: drawing,
    trouble,
    toggle: () => {
      const next = !drawing;
      setDrawing(next);
      void command("island_visualizer_set", { on: next }).catch((failure) => setTrouble(String(failure)));
    },
  };
}
