import type { Pane } from "@/panes";
import type { Answer, Capability, Project, Route, Session, Skill, Turn } from "@/sessions";

/// A workspace that does not exist, so the window can be used in a browser with no sidecars
/// running. Nothing outside a development preview ever reaches it.
const sessions = new Map<string, Session>();
const said = new Map<string, Turn[]>();
let order = 0;

function make(pane: Pane, title: string, turns: Array<[Turn["role"], string]>): void {
  const id = `made-up-${(order += 1)}`;
  const at = Date.now() - (9 - order) * 3_600_000;
  sessions.set(id, { id, pane, title, started: at, touched: at + turns.length, turns: turns.length });
  said.set(
    id,
    turns.map(([role, text], step) => ({
      role,
      text,
      at: at + step,
      ...(role === "assistant" ? { by: { model: "nobody", route: "local-small", usage: { input: 900 + step * 350, output: 80 } } } : {}),
    })),
  );
}

make("comms", "what does today hold", [
  ["user", "what does today hold"],
  ["assistant", "Nothing on your calendar until three. Two unread from Petra Holst."],
]);
make("knowledge", "thermodynamics revision", [
  ["user", "what have I written about carnot cycles"],
  ["assistant", "Three notes mention them, all from week seven of Thermodynamics."],
  ["user", "summarise the lecture note"],
  ["assistant", "It works through the four stages and ends on why the efficiency bound is a limit rather than a target."],
]);
make("development", "the mind graph", [
  ["user", "where did I stop on the graph window"],
  ["assistant", "The whirlpool layout was the last thing changed, with the middle drawn as an icosahedron."],
]);
for (const [pane, title] of [
  ["knowledge", "signals and systems week seven"],
  ["comms", "reply to Dr Delgado"],
  ["development", "where did I stop on harbor-os"],
  ["chat", "what is a carnot cycle"],
  ["knowledge", "reading list for the holidays"],
] as const) {
  make(pane, title, [["user", title], ["assistant", "A stand-in answer."]]);
}

const CAPABILITIES: Capability[] = [
  { id: "tool:today", label: "today", description: "What the user's day holds.", pane: "comms" },
  { id: "tool:remember", label: "remember", description: "Search the user's own notes.", pane: "knowledge" },
  { id: "tool:add_to_notion", label: "add_to_notion", description: "Add one entry to a Notion database.", pane: "knowledge" },
  { id: "tool:read_file", label: "read_file", description: "Read a text file from disk.", pane: "development" },
  { id: "tool:list_directory", label: "list_directory", description: "List the entries of a directory.", pane: "development" },
  { id: "tool:write_file", label: "write_file", description: "Write text to a file.", pane: "development" },
];

const forged: Skill[] = [
  {
    id: "forged-1",
    name: "weather_now",
    about: "The current weather in a named city, from the open weather service.",
    method: "GET",
    url: "https://api.open-meteo.com/v1/forecast/{city}",
    parameters: [
      { name: "city", in: "path", kind: "string", required: true, about: "the city to look up" },
      { name: "units", in: "query", kind: "string", required: false, about: "metric or imperial" },
    ],
    headers: { accept: "application/json" },
    auth: { mode: "none" },
    reads: "json",
    state: "pending",
    drafted: Date.now() - 600_000,
  },
  {
    id: "forged-2",
    name: "shorten_link",
    about: "Shorten a long address into a short one.",
    method: "POST",
    url: "https://api.example.com/v1/shorten",
    parameters: [{ name: "target", in: "body", kind: "string", required: true, about: "the address" }],
    headers: {},
    auth: { mode: "bearer", credential: "shortener" },
    reads: "json",
    state: "broken",
    drafted: Date.now() - 86_400_000,
    trouble: "shorten_link answered 401",
  },
];

function recency(one: Session, two: Session): number {
  return two.touched - one.touched;
}

export const pretend = {
  list(pane?: Pane): Session[] {
    const all = [...sessions.values()].filter((one) => pane === undefined || one.pane === pane);
    return all.sort(recency);
  },

  read(id: string): { session: Session; turns: Turn[] } {
    const session = sessions.get(id);
    if (!session) throw new Error("that is not a session Kyuren holds");
    return { session, turns: said.get(id) ?? [] };
  },

  start(pane: Pane, title?: string): Session {
    const id = `made-up-${(order += 1)}`;
    const at = Date.now();
    const session = { id, pane, title: title ?? "new session", started: at, touched: at, turns: 0 };
    sessions.set(id, session);
    said.set(id, []);
    return session;
  },

  rename(id: string, title: string): void {
    const session = sessions.get(id);
    if (session) sessions.set(id, { ...session, title });
  },

  prefer(id: string, route: Route | undefined): void {
    const session = sessions.get(id);
    if (session) sessions.set(id, { ...session, preferred: route });
  },

  forget(id: string): void {
    sessions.delete(id);
    said.delete(id);
  },

  /// A real turn takes a moment, so this one does too: without the wait there is nothing to see
  /// of what is shown while an answer is being waited for.
  async ask(prompt: string, where: { session?: string; pane?: Pane }): Promise<Answer> {
    await new Promise((ready) => setTimeout(ready, 1100));
    const id = where.session ?? this.start(where.pane ?? "comms", prompt).id;
    const text = [
      `There are no sidecars running, so this is a **stand-in** for an answer to "${prompt}".`,
      "",
      "It exists to show how an answer is laid out:",
      "",
      "- lists come out as lists",
      "- `code` keeps its own face",
      "- a [link](https://example.com/) opens in your own browser, and a citation [1](https://example.com/) reads as one",
      "- and a fenced block keeps its shape",
      "",
      "```ts",
      "const answer = await ask(prompt, { pane });",
      "```",
    ].join("\n");
    const turns = said.get(id) ?? [];
    const at = Date.now();
    const by = { model: "nobody", route: "local-small", usage: { input: 1840, output: 96 } };
    turns.push({ role: "user", text: prompt, at });
    turns.push({ role: "assistant", text, at: at + 1, by });
    said.set(id, turns);
    const session = sessions.get(id);
    if (session) sessions.set(id, { ...session, touched: at + 1, turns: turns.length });
    return {
      text,
      session: id,
      model: "nobody",
      route: "local-small",
      reason: "there is nothing behind this window",
      steps: 1,
      called: [{ tool: "remember", target: "the user's notes", ok: true }],
      elapsedMs: 0,
      usage: by.usage,
    };
  },

  capabilities(): Capability[] {
    return CAPABILITIES;
  },

  skills(): Skill[] {
    return forged;
  },

  approveSkill(id: string): void {
    const at = forged.findIndex((one) => one.id === id);
    if (at >= 0) forged[at] = { ...forged[at]!, state: "approved", approved: Date.now() };
  },

  forgetSkill(id: string): void {
    const at = forged.findIndex((one) => one.id === id);
    if (at >= 0) forged.splice(at, 1);
  },

  projects(): Project[] {
    const day = 86_400_000;
    return [
      { name: "kyuren", path: "~/Documents/Coding/kyuren", branch: "main", upstream: "origin/main", ahead: 0, behind: 0, dirty: 1, lastAt: Date.now() - 2 * 3_600_000, lastSaid: "ask before letting go of a conversation" },
      { name: "lantern-browser", path: "~/Documents/Coding/lantern-browser", branch: "main", upstream: "origin/main", ahead: 18, behind: 0, dirty: 29, lastAt: Date.now() - 8 * day, lastSaid: "tidy the toolbar's focus order" },
      { name: "tidepool", path: "~/Documents/Coding/tidepool", branch: "main", ahead: 7, behind: 0, dirty: 0, lastAt: Date.now() - 12 * day, lastSaid: "bump to 0.3.0" },
      { name: "orchard", path: "~/Documents/Coding/orchard", branch: "main", upstream: "origin/main", ahead: 0, behind: 0, dirty: 10, lastAt: Date.now() - 48 * day, lastSaid: "fix the cache warm-up" },
      ...["quillnote", "rivulet", "foxglove", "paperkite", "ledgerline", "harbor-os", "saltmarsh"].map(
        (name, at) => ({
          name,
          path: `~/Documents/Coding/${name}`,
          branch: at % 3 === 0 ? "master" : "main",
          upstream: at % 4 === 0 ? undefined : "origin/main",
          ahead: at % 3,
          behind: 0,
          dirty: (at * 3) % 11,
          lastAt: Date.now() - (60 + at * 30) * day,
          lastSaid: "an older piece of work",
        }),
      ),
    ];
  },
};
