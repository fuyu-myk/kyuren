/// The places work is organised into. Every session belongs to one of them; chat is where a
/// conversation that is not about any one of the others belongs.
export const PANES = ["chat", "comms", "knowledge", "development", "research"] as const;

export type Pane = (typeof PANES)[number];

export function paneIn(given: unknown): Pane | undefined {
  return PANES.find((one) => one === given);
}
