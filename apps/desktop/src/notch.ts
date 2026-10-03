import { invoke } from "@tauri-apps/api/core";
import { TABS, type Tab } from "@/island/fsm";
import { insideTauri } from "@/tauri";

/// The widgets the island's glance tab can hold.
export const WIDGETS = ["music", "pomodoro", "network", "system"] as const;
export type Widget = (typeof WIDGETS)[number];

/// Outside the app, in a browser, the settings live here instead, so the layout can be tried.
const preview: { tabs: Tab[]; widgets: Widget[]; home: Tab | null; shortcuts: string[] } = { tabs: [...TABS], widgets: [], home: null, shortcuts: [] };

function kept<T extends string>(known: readonly T[], chosen: T[]): T[] {
  return chosen.filter((one, at) => known.includes(one) && chosen.indexOf(one) === at);
}

/// Which of the island's tabs are shown, in the order arranged.
export function islandTabs(): Promise<Tab[]> {
  return insideTauri() ? invoke<Tab[]>("island_tabs") : Promise.resolve([...preview.tabs]);
}

export function setIslandTabs(tabs: Tab[]): Promise<Tab[]> {
  if (insideTauri()) return invoke<Tab[]>("island_tabs_set", { tabs });
  preview.tabs = kept(TABS, tabs);
  return Promise.resolve([...preview.tabs]);
}

/// The widgets switched on for the glance, in the order arranged.
export function islandWidgets(): Promise<Widget[]> {
  return insideTauri() ? invoke<Widget[]>("island_widgets") : Promise.resolve([...preview.widgets]);
}

export function setIslandWidgets(widgets: Widget[]): Promise<Widget[]> {
  if (insideTauri()) return invoke<Widget[]>("island_widgets_set", { widgets });
  preview.widgets = kept(WIDGETS, widgets);
  return Promise.resolve([...preview.widgets]);
}

/// The playbooks the island's shortcuts page offers, in the order chosen.
export function islandShortcuts(): Promise<string[]> {
  return insideTauri() ? invoke<string[]>("island_shortcuts") : Promise.resolve([...preview.shortcuts]);
}

export function setIslandShortcuts(names: string[]): Promise<string[]> {
  if (insideTauri()) return invoke<string[]>("island_shortcuts_set", { names });
  preview.shortcuts = names.filter((one, at) => names.indexOf(one) === at);
  return Promise.resolve([...preview.shortcuts]);
}

/// The page the island opens on whenever the notch is expanded, or none for what needs the user.
export function islandHome(): Promise<Tab | null> {
  return insideTauri() ? invoke<Tab | null>("island_home") : Promise.resolve(preview.home);
}

export function setIslandHome(home: Tab | null): Promise<Tab | null> {
  if (insideTauri()) return invoke<Tab | null>("island_home_set", { home });
  preview.home = home;
  return Promise.resolve(home);
}
