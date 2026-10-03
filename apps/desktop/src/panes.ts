/// The three parts of the workspace. The keys are what the core stores against a session; the rest
/// is what the window calls them.
export const PANES = [
  {
    key: "chat",
    title: "chat",
    about: "anything at all",
  },
  {
    key: "comms",
    title: "comms and calendar",
    about: "mail, messages, and what the day holds",
  },
  {
    key: "knowledge",
    title: "knowledge and memory",
    about: "notes, vaults, and what has been written down",
  },
  {
    key: "development",
    title: "development and projects",
    about: "repositories, branches, and work in flight",
  },
  {
    key: "research",
    title: "research",
    about: "questions answered from the web, with sources",
  },
] as const;

export type Pane = (typeof PANES)[number]["key"];

export function paneNamed(key: string): (typeof PANES)[number] | undefined {
  return PANES.find((one) => one.key === key);
}
