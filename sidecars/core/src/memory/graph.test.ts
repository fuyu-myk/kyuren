import assert from "node:assert/strict";
import { test } from "node:test";
import type { Entity } from "#entity/gather.ts";
import { memoryGraph } from "#memory/graph.ts";
import type { Held } from "#memory/index.ts";

function chunk(file: string, text = "words"): Held {
  return { hash: `${file}:${text}`, text, heading: "", file };
}

function entity(name: string, files: string[]): Entity {
  return { name, aliases: [name], parts: [], files, chunks: [], mentions: files.length, proven: true };
}

test("every note is a node, named as a person would name it", () => {
  const graph = memoryGraph([chunk("/vault/days/2026-09-15.md")], []);
  assert.deepEqual(graph.nodes.map((one) => one.label), ["2026-09-15"]);
  assert.equal(graph.nodes[0]?.kind, "note");
});

test("a note with more in it counts for more", () => {
  const graph = memoryGraph(
    [chunk("/vault/big.md", "a"), chunk("/vault/big.md", "b"), chunk("/vault/small.md")],
    [],
  );
  const by = new Map(graph.nodes.map((one) => [one.label, one.weight]));
  assert.ok((by.get("big") ?? 0) > (by.get("small") ?? 0));
});

test("what joins two notes is the thing they both talk about", () => {
  const graph = memoryGraph(
    [chunk("/vault/a.md"), chunk("/vault/b.md")],
    [entity("Petra Holst", ["/vault/a.md", "/vault/b.md"])],
  );

  const petra = graph.nodes.find((one) => one.kind === "entity");
  assert.ok(petra);
  assert.equal(graph.links.length, 2, "two notes about one person, joined through her");
  assert.ok(graph.links.every((one) => one.from === petra.id));
  assert.equal(
    graph.links.filter((one) => one.from.startsWith("note:") && one.to.startsWith("note:")).length,
    0,
    "notes are not wired to each other directly",
  );
});

test("someone mentioned in a note that is not indexed is not linked to nothing", () => {
  const graph = memoryGraph(
    [chunk("/vault/a.md")],
    [entity("Petra", ["/vault/a.md", "/vault/gone.md"])],
  );
  assert.equal(graph.links.length, 1, "a link to a note that is not here would dangle");
});

test("an empty vault is an empty graph rather than an error", () => {
  assert.deepEqual(memoryGraph([], []), { nodes: [], links: [] });
});

test("a chunk belonging to no file does not become a node", () => {
  assert.deepEqual(memoryGraph([chunk("")], []).nodes, []);
});

test("a note from a connected folder is its own layer, and someone in my own notes is memory", () => {
  const own = "/home/.kyuren/vault";
  const graph = memoryGraph(
    [chunk(`${own}/a.md`), chunk("/obsidian/b.md"), chunk("/obsidian/c.md")],
    [entity("Petra", [`${own}/a.md`, "/obsidian/b.md"]), entity("Sam", ["/obsidian/b.md", "/obsidian/c.md"])],
    own,
  );
  const by = new Map(graph.nodes.map((one) => [one.label, one.layer]));
  assert.equal(by.get("a"), "memory");
  assert.equal(by.get("b"), "connected");
  assert.equal(by.get("c"), "connected");
  assert.equal(by.get("Petra"), "memory", "someone in my own notes is memory wherever else they appear");
  assert.equal(by.get("Sam"), "connected");
});

test("a folder whose name merely begins like the own vault is not the own vault", () => {
  const graph = memoryGraph([chunk("/home/.kyuren/vault-old/a.md")], [], "/home/.kyuren/vault");
  assert.equal(graph.nodes[0]?.layer, "connected");
});

test("with no own vault named, everything is memory", () => {
  const graph = memoryGraph([chunk("/anywhere/a.md")], [entity("Sam", ["/anywhere/a.md"])]);
  assert.ok(graph.nodes.every((one) => one.layer === "memory"));
});

test("someone in a single note from elsewhere joins nothing and is left out of the picture", () => {
  const own = "/home/.kyuren/vault";
  const graph = memoryGraph(
    [chunk(`${own}/a.md`), chunk("/obsidian/b.md"), chunk("/obsidian/c.md")],
    [
      entity("Once", ["/obsidian/b.md"]),
      entity("Twice", ["/obsidian/b.md", "/obsidian/c.md"]),
      entity("Mine", [`${own}/a.md`]),
    ],
    own,
  );
  const names = graph.nodes.filter((one) => one.kind === "entity").map((one) => one.label).sort();
  assert.deepEqual(names, ["Mine", "Twice"], "what my own notes mention is always kept");
});

test("the picture keeps to a thousand things, keeping what joins the most notes", () => {
  const notes = Array.from({ length: 20 }, (_, at) => `/obsidian/n${at}.md`);
  const entities = Array.from({ length: 1500 }, (_, at) =>
    entity(`e${at}`, notes.slice(0, 2 + (at % 19))));
  const graph = memoryGraph(notes.map((file) => chunk(file)), entities, "/home/.kyuren/vault");
  assert.ok(graph.nodes.length <= 1000, `${graph.nodes.length} is more than the mind can carry`);
  assert.equal(graph.nodes.filter((one) => one.kind === "note").length, 20, "every note stays");
  const kept = new Set(graph.nodes.map((one) => one.label));
  assert.ok(kept.has("e18"), "the one in the most notes is kept");
  assert.ok(!kept.has("e0"), "the one in the fewest goes first");
});
