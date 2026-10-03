import { useEffect, useRef, useState, type PointerEvent as Pointer } from "react";
import { TABS, type Tab } from "@/island/fsm";
import { TabIcon, TITLES } from "@/island/icons";
import { arranged, landing, slot } from "@/layout";
import { islandHome, islandTabs, islandWidgets, setIslandHome, setIslandTabs, setIslandWidgets, WIDGETS, type Widget } from "@/notch";

type Props = { onTrouble: (message: string) => void };

type Kind = "tab" | "widget";
type Held = { kind: Kind; name: string; startX: number; startY: number; x: number; y: number; moved: boolean };
type Over = { into: "shown" | "hidden"; at: number };

/// How each widget is named here, and how wide it is in the island, for the preview to be true to it.
const WIDGET: Record<Widget, { name: string; width: number }> = {
  music: { name: "now playing", width: 192 },
  pomodoro: { name: "pomodoro", width: 106 },
  network: { name: "network", width: 150 },
  system: { name: "system", width: 150 },
};

/// A drag shorter than this is a click.
const STILL = 4;

/// The island's layout, arranged on a small picture of it: its pages beside the notch and the
/// glance's widgets below, dragged into the order wanted or out to the hidden ones, a click
/// showing or hiding one; and which page it opens on.
export function IslandLayout({ onTrouble }: Props) {
  const [tabs, setTabs] = useState<Tab[]>();
  const [widgets, setWidgets] = useState<Widget[]>();
  const [home, setHome] = useState<Tab | null>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const tabRow = useRef<HTMLDivElement>(null);
  const widgetRow = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void islandTabs().then(setTabs).catch((failure) => onTrouble(String(failure)));
    void islandWidgets().then(setWidgets).catch((failure) => onTrouble(String(failure)));
    void islandHome().then(setHome).catch(() => setHome(null));
  }, [onTrouble]);

  const saveTabs = async (next: Tab[]) => {
    setTabs(next);
    try {
      setTabs(await setIslandTabs(next));
    } catch (failure) {
      onTrouble(String(failure));
    }
  };

  const saveWidgets = async (next: Widget[]) => {
    setWidgets(next);
    try {
      setWidgets(await setIslandWidgets(next));
    } catch (failure) {
      onTrouble(String(failure));
    }
  };

  const saveHome = async (next: Tab | null) => {
    setHome(next);
    try {
      setHome(await setIslandHome(next));
    } catch (failure) {
      onTrouble(String(failure));
    }
  };

  if (!tabs || !widgets) {
    return (
      <section>
        <h3>island</h3>
        <p className="hint">asking</p>
      </section>
    );
  }

  const shownOf = (kind: Kind): string[] => (kind === "tab" ? tabs : widgets);
  const rowOf = (kind: Kind) => (kind === "tab" ? tabRow.current : widgetRow.current);

  const where = (kind: Kind, x: number, y: number): Over | null => {
    const inside = (box: DOMRect | undefined) => !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    const row = rowOf(kind);
    if (row && inside(row.getBoundingClientRect())) {
      const boxes = [...row.querySelectorAll<HTMLElement>("[data-chip]")].map((one) => one.getBoundingClientRect());
      return { into: "shown", at: slot(x, boxes) };
    }
    if (inside(tray.current?.getBoundingClientRect())) return { into: "hidden", at: 0 };
    return null;
  };

  const grab = (kind: Kind, name: string) => (event: Pointer<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setHeld({ kind, name, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false });
  };

  const move = (event: Pointer<HTMLElement>) => {
    if (!held) return;
    const moved = held.moved || Math.hypot(event.clientX - held.startX, event.clientY - held.startY) > STILL;
    setHeld({ ...held, x: event.clientX, y: event.clientY, moved });
    setOver(moved ? where(held.kind, event.clientX, event.clientY) : null);
  };

  const drop = () => {
    if (!held) return;
    const shown = shownOf(held.kind);
    const isShown = shown.includes(held.name);
    let next: string[] | null = null;
    if (!held.moved) {
      next = isShown ? shown.filter((one) => one !== held.name) : [...shown, held.name];
    } else if (over) {
      next = arranged(shown, held.name, over.into, landing(over.at, shown.indexOf(held.name)));
    }
    if (next) {
      if (held.kind === "tab") void saveTabs(next as Tab[]);
      else void saveWidgets(next as Widget[]);
    }
    setHeld(null);
    setOver(null);
  };

  const chip = (kind: Kind, name: string, shown: boolean) => {
    const dragging = held?.name === name && held.kind === kind && held.moved;
    const label = kind === "tab" ? TITLES[name as Tab] : WIDGET[name as Widget].name;
    return (
      <button
        key={`${kind}:${name}`}
        type="button"
        data-chip={shown ? "" : undefined}
        className={`chip ${kind}${shown ? " on" : ""}${dragging ? " lifted" : ""}`}
        style={kind === "widget" && shown ? { flexGrow: WIDGET[name as Widget].width } : undefined}
        aria-pressed={shown}
        title={shown ? `${label}: drag to move, click to hide` : `${label}: drag in or click to show`}
        onPointerDown={grab(kind, name)}
        onPointerMove={move}
        onPointerUp={drop}
        onPointerCancel={() => {
          setHeld(null);
          setOver(null);
        }}
      >
        {kind === "tab" ? <TabIcon tab={name as Tab} /> : null}
        {kind === "widget" || !shown ? <span>{label}</span> : null}
      </button>
    );
  };

  const marker = (kind: Kind) =>
    held?.kind === kind && held.moved && over?.into === "shown" ? (
      <span className="marker" style={{ order: over.at * 2 - 1 }} aria-hidden="true" />
    ) : null;

  const hiddenTabs = TABS.filter((tab) => !tabs.includes(tab));
  const hiddenWidgets = WIDGETS.filter((one) => !widgets.includes(one));

  return (
    <section className="island-layout">
      <h3>island</h3>
      <p className="hint">drag its pages and the glance's widgets to arrange them, or out to hide them; a click shows or hides one</p>
      <div className="mini" aria-label="the island, open">
        <div className="mini-notch" />
        <div className="mini-tabs" ref={tabRow}>
          {tabs.map((tab, at) => (
            <span key={tab} className="slot" style={{ order: at * 2 }}>
              {chip("tab", tab, true)}
            </span>
          ))}
          {marker("tab")}
        </div>
        <div className={`mini-glance${over?.into === "shown" && held?.kind === "widget" ? " over" : ""}`} ref={widgetRow}>
          {widgets.length === 0 ? <span className="mini-empty">the glance is empty: drag a widget here</span> : null}
          {widgets.map((one, at) => (
            <span key={one} className="slot" style={{ order: at * 2, flexGrow: WIDGET[one].width }}>
              {chip("widget", one, true)}
            </span>
          ))}
          {marker("widget")}
        </div>
      </div>
      <div className={`tray${over?.into === "hidden" ? " over" : ""}`} ref={tray}>
        <span className="tray-label">hidden</span>
        {hiddenTabs.map((tab) => chip("tab", tab, false))}
        {hiddenWidgets.map((one) => chip("widget", one, false))}
        {hiddenTabs.length + hiddenWidgets.length === 0 ? <span className="tray-empty">nothing</span> : null}
      </div>
      <label className="opens-on">
        <span>when the notch opens, show</span>
        <select value={home ?? ""} onChange={(event) => void saveHome((event.target.value || null) as Tab | null)}>
          <option value="">what needs you first</option>
          {tabs.map((tab) => (
            <option key={tab} value={tab}>
              {TITLES[tab]}
            </option>
          ))}
        </select>
      </label>
      {held?.moved ? (
        <span className={`chip ghost-chip ${held.kind}`} style={{ left: held.x, top: held.y }} aria-hidden="true">
          {held.kind === "tab" ? TITLES[held.name as Tab] : WIDGET[held.name as Widget].name}
        </span>
      ) : null}
    </section>
  );
}
