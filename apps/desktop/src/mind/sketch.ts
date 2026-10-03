import type { Drawn, Edge } from "@/mind/render";

const PEOPLE = ["Petra Holst", "Dr Delgado", "Sam", "Ana Lindqvist", "Mum"];
const COURSES = ["Signals and Systems", "Thermodynamics", "Linear Algebra", "Ethics in AI"];
const NOTES = [
  "week 7 lecture", "reading list", "lab writeup", "exam plan", "supervision notes",
  "tutorial questions", "paper skim", "problem set 4", "revision map", "seminar notes",
  "group project", "reflection", "office hours", "field notes", "summary",
];
const TOOLS = [
  ["today", "What the user's day holds."],
  ["remember", "Search the user's own notes."],
  ["write_file", "Write text to a file."],
] as const;

/// A mind that does not exist, so the look of the graph can be judged in a browser with no
/// sidecars running. Nothing outside a development preview ever asks for it. Asked for many
/// times over, it is the same mind repeated, which is enough to see how a large one moves.
export function sketch(times = 1): { nodes: Drawn[]; links: Edge[] } {
  const one = once();
  if (times <= 1) return one;

  const nodes: Drawn[] = [...one.nodes];
  const links: Edge[] = [...one.links];
  for (let copy = 1; copy < times; copy += 1) {
    for (const node of one.nodes) {
      if (node.kind === "tool" || node.kind === "step") continue;
      nodes.push({ ...node, id: `${node.id}#${copy}` });
    }
    for (const link of one.links) {
      if (link.from.startsWith("step:")) continue;
      links.push({ ...link, from: `${link.from}#${copy}`, to: `${link.to}#${copy}` });
    }
  }
  return { nodes, links };
}

function once(): { nodes: Drawn[]; links: Edge[] } {
  const nodes: Drawn[] = [];
  const links: Edge[] = [];

  for (const [at, name] of [...PEOPLE, ...COURSES].entries()) {
    nodes.push({
      id: `entity:${name}`,
      label: name,
      layer: "memory",
      kind: "entity",
      weight: 3 + (at % 5) * 4,
    });
  }

  for (const [at, title] of NOTES.entries()) {
    const about = at % (PEOPLE.length + COURSES.length);
    const name = [...PEOPLE, ...COURSES][about]!;
    const id = `note:${title}`;
    nodes.push({ id, label: title, layer: "memory", kind: "note", weight: 1 + (at % 4) });
    links.push({ from: id, to: `entity:${name}`, strength: 1 });
    if (at % 3 === 0) {
      const second = [...PEOPLE, ...COURSES][(about + 4) % (PEOPLE.length + COURSES.length)]!;
      links.push({ from: id, to: `entity:${second}`, strength: 0.6 });
    }
  }

  // Notes from a folder someone already keeps, connected read only, about people already known.
  for (const [at, title] of ["signals map", "holst meeting", "gig setlist"].entries()) {
    const id = `note:${title}`;
    nodes.push({ id, label: title, layer: "connected", kind: "note", weight: 2 + at });
    links.push({ from: id, to: `entity:${PEOPLE[at % PEOPLE.length]}`, strength: 1 });
  }

  for (const [tool, says] of TOOLS) {
    nodes.push({
      id: `tool:${tool}`,
      label: tool,
      layer: "capability",
      kind: "tool",
      weight: 6,
      description: says,
    });
  }

  // A turn part way through, so the live layer has something in it to look at. In the app these
  // arrive as the assistant works, and go when the session does.
  nodes.push({
    id: "step:sketch:1",
    label: "remember",
    layer: "reasoning",
    kind: "step",
    weight: 2,
    description: "signals and systems",
    running: true,
  });
  nodes.push({
    id: "step:sketch:2",
    label: "today",
    layer: "reasoning",
    kind: "step",
    weight: 2,
    description: "tuesday",
  });
  links.push({ from: "step:sketch:1", to: "tool:remember", strength: 1 });
  links.push({ from: "step:sketch:2", to: "tool:today", strength: 1 });

  return { nodes, links };
}
