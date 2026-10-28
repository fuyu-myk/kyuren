import type { ReactElement } from "react";
import type { Snapshot } from "@/island/glance";
import { Music, type Player } from "@/island/views/Music";
import { NextEvent } from "@/island/views/NextEvent";
import { NetworkGraph } from "@/island/views/NetworkGraph";
import { Pomodoro, type Timer } from "@/island/views/Pomodoro";
import { SystemBars } from "@/island/views/SystemBars";
import type { Week } from "@/island/week";

type Props = {
  widgets: string[];
  snapshot: Snapshot | null;
  timer: Timer;
  player: Player;
  calendar: { week: Week | null; now: number };
};

/// The widgets switched on in settings, side by side.
export function Glance({ widgets, snapshot, timer, player, calendar }: Props) {
  const drawn: Record<string, () => ReactElement> = {
    music: () => <Music key="music" player={player} />,
    pomodoro: () => <Pomodoro key="pomodoro" timer={timer} />,
    network: () => <NetworkGraph key="network" traffic={snapshot?.traffic ?? []} />,
    system: () => <SystemBars key="system" snapshot={snapshot} />,
    next: () => <NextEvent key="next" week={calendar.week} now={calendar.now} />,
  };
  // In the order the user arranged them in settings.
  return <div className="view glance">{widgets.map((one) => drawn[one]?.() ?? null)}</div>;
}
