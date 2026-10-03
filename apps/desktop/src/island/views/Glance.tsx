import type { ReactElement } from "react";
import type { Snapshot } from "@/island/glance";
import { Music, type Player } from "@/island/views/Music";
import { NetworkGraph } from "@/island/views/NetworkGraph";
import { Pomodoro, type Timer } from "@/island/views/Pomodoro";
import { SystemBars } from "@/island/views/SystemBars";

type Props = {
  widgets: string[];
  snapshot: Snapshot | null;
  timer: Timer;
  player: Player;
};

/// The widgets switched on in settings, side by side.
export function Glance({ widgets, snapshot, timer, player }: Props) {
  const drawn: Record<string, () => ReactElement> = {
    music: () => <Music key="music" player={player} />,
    pomodoro: () => <Pomodoro key="pomodoro" timer={timer} />,
    network: () => <NetworkGraph key="network" traffic={snapshot?.traffic ?? []} />,
    system: () => <SystemBars key="system" snapshot={snapshot} />,
  };
  // In the order the user arranged them in settings.
  return <div className="view glance">{widgets.map((one) => drawn[one]?.() ?? null)}</div>;
}
