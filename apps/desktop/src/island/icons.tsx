import type { Tab } from "@/island/fsm";

/// Drawn as paths rather than taken from a font, which differs between webviews.
const PATHS: Record<Tab, string> = {
  voice: "M8 2.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-4 0V4.5a2 2 0 0 1 2-2Z M4.5 7.5a3.5 3.5 0 0 0 7 0 M8 11v2.5",
  permissions: "M8 2 3.5 3.8v3.6c0 2.9 1.9 5 4.5 6.1 2.6-1.1 4.5-3.2 4.5-6.1V3.8L8 2Z M6.2 8l1.3 1.3L10 6.8",
  work: "M3 4.5h6 M3 8h10 M3 11.5h7 M11.5 3.5l1.5 1-1.5 1",
  coding: "M5.5 4.5 2.5 8l3 3.5 M10.5 4.5l3 3.5-3 3.5 M9.2 3 6.8 13",
  glance: "M2.8 2.8h4.2v4.2H2.8z M9 2.8h4.2v4.2H9z M2.8 9h4.2v4.2H2.8z M9 9h4.2v4.2H9z",
  shelf: "M2.5 9.2 4.2 3.5h7.6l1.7 5.7v3.3h-11Z M2.5 9.2h3.1l.8 1.4h3.2l.8-1.4h3.1",
  shortcuts: "M9.2 1.8 3.6 9h4.1l-.9 5.2L12.4 7H8.3l.9-5.2Z",
  notices: "M8 2.5a3.5 3.5 0 0 0-3.5 3.5v2.4L3.3 10.6h9.4l-1.2-2.2V6A3.5 3.5 0 0 0 8 2.5Z M6.6 12.6a1.5 1.5 0 0 0 2.8 0",
};

export const TITLES: Record<Tab, string> = {
  voice: "voice",
  permissions: "waiting on you",
  work: "at work",
  coding: "coding",
  glance: "glance",
  shelf: "shelf",
  shortcuts: "shortcuts",
  notices: "noticed",
};

export function TabIcon({ tab }: { tab: Tab }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d={PATHS[tab]} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
