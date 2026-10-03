import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { minutes, played, type Playing } from "@/island/glance";
import { pacer } from "@/island/pacer";

export type Player = {
  playing: Playing | null;
  art: string | null;
  /// Why the last control did not reach the player, such as not yet being allowed to.
  trouble: string | null;
  control: (action: "toggle" | "next" | "previous" | "seek", value?: number) => void;
  /// Sets the player's volume, the player read again only once the level has `settled`.
  volume: (level: number, settled: boolean) => Promise<void>;
  /// Asks the open players what they play, for a widget that has heard nothing yet.
  ask: () => void;
};

function Icon({ d, filled = false, size = 16 }: { d: string; filled?: boolean; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d={d} fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PLAY = "M5 3.4l7.2 4.6L5 12.6Z";
const PAUSE = "M4.6 3.5h2.4v9H4.6z M9 3.5h2.4v9H9z";
const NEXT = "M3.5 3.8l6 4.2-6 4.2Z M10.8 3.8h1.8v8.4h-1.8z";
const PREVIOUS = "M12.5 3.8l-6 4.2 6 4.2Z M5.2 3.8H3.4v8.4h1.8z";
const SPEAKER = "M3 6.2h2.2L8.2 3.6v8.8L5.2 9.8H3Z M10.6 5.8a3 3 0 0 1 0 4.4 M12.2 4.2a5.2 5.2 0 0 1 0 7.6";

/// What is playing in Spotify or Music: the cover, the track, where it is with room to seek, and
/// play, pause and skip. The player's own volume shows only under the cursor.
export function Music({ player }: { player: Player }) {
  const { playing, art } = player;
  const [, redraw] = useState(0);
  const [volume, setVolume] = useState<number | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  // The level follows the slider as it moves, as fast as the player takes it, and what the player
  // says meanwhile is not let move the slider back under the cursor.
  const dragging = useRef(false);
  const level = useRef<number | null>(null);
  const toPlayer = useRef(player.volume);
  toPlayer.current = player.volume;
  const send = useMemo(() => pacer<{ level: number; settled: boolean }>((one) => toPlayer.current(one.level, one.settled)), []);

  useEffect(() => {
    if (!playing?.playing) return;
    const ticking = setInterval(() => redraw((count) => count + 1), 500);
    return () => clearInterval(ticking);
  }, [playing?.playing]);

  useEffect(() => {
    if (!dragging.current && playing?.volume !== null && playing?.volume !== undefined) setVolume(playing.volume);
  }, [playing?.volume]);

  if (!playing) {
    // The players say what they play when it changes, so until then, or until asked, nothing is known.
    return (
      <div className="widget music quiet">
        <p className="empty">Nothing heard from Spotify or Music yet.</p>
        <button type="button" className="ask" onClick={player.ask}>
          ask what is playing
        </button>
        {player.trouble ? <p className="trouble">{player.trouble}</p> : null}
      </div>
    );
  }

  const at = played(playing, Date.now());
  const seek = (clientX: number) => {
    const box = bar.current?.getBoundingClientRect();
    if (!box || playing.duration <= 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    player.control("seek", fraction * playing.duration);
  };

  return (
    <div className="widget music">
      <div className="cover">{art ? <img src={art} alt="" /> : <Icon d="M6 11.5V4l6-1.5V10 M6 11.5a1.8 1.8 0 1 1-1.8-1.8A1.8 1.8 0 0 1 6 11.5Z M12 10a1.8 1.8 0 1 1-1.8-1.8A1.8 1.8 0 0 1 12 10Z" size={28} />}</div>
      <div className="volume" title="the player's volume">
        <Icon d={SPEAKER} size={13} />
        <input
          type="range"
          min={0}
          max={100}
          value={volume ?? 50}
          style={{ "--level": `${volume ?? 50}%` } as CSSProperties}
          onChange={(event) => {
            const to = Number(event.target.value);
            level.current = to;
            setVolume(to);
            send({ level: to, settled: !dragging.current });
          }}
          onPointerDown={() => {
            dragging.current = true;
            // Let go anywhere, the slider's own track or not.
            const done = () => {
              dragging.current = false;
              if (level.current !== null) send({ level: level.current, settled: true });
            };
            window.addEventListener("pointerup", done, { once: true });
          }}
        />
      </div>
      <div className="track">
        <strong className="title">{playing.title || "Untitled"}</strong>
        <span className="by">{[playing.artist, playing.album].filter(Boolean).join(" - ")}</span>
        <div className="scrub">
          <span>{at === null ? "" : minutes(at)}</span>
          <div
            ref={bar}
            className="line"
            onPointerDown={(event) => seek(event.clientX)}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={playing.duration}
            aria-valuenow={at ?? 0}
          >
            <div className="done" style={{ width: at === null || playing.duration <= 0 ? "0%" : `${(at / playing.duration) * 100}%` }} />
          </div>
          <span>{at === null ? minutes(playing.duration) : `-${minutes(playing.duration - at)}`}</span>
        </div>
        <div className="controls">
          <button type="button" title="previous" onClick={() => player.control("previous")}>
            <Icon d={PREVIOUS} filled />
          </button>
          <button type="button" className="go" title={playing.playing ? "pause" : "play"} onClick={() => player.control("toggle")}>
            <Icon d={playing.playing ? PAUSE : PLAY} filled />
          </button>
          <button type="button" title="next" onClick={() => player.control("next")}>
            <Icon d={NEXT} filled />
          </button>
        </div>
        {player.trouble ? <p className="trouble">{player.trouble}</p> : null}
      </div>
    </div>
  );
}
