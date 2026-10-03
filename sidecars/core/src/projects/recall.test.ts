import assert from "node:assert/strict";
import { test } from "node:test";
import { matched, opening, summarise } from "#projects/recall.ts";
import type { Project } from "#projects/state.ts";

function project(name: string): Project {
  return { name, path: `/where/${name}`, branch: "main", ahead: 0, behind: 0, dirty: 0 };
}

const projects = [project("kyuren"), project("kyuren-website"), project("lantern-browser")];

test("an exact name wins over one that merely starts the same", () => {
  assert.equal(matched(projects, "kyuren")?.name, "kyuren");
  assert.equal(matched(projects, "KYUREN")?.name, "kyuren");
});

test("half a name is enough", () => {
  assert.equal(matched(projects, "lantern")?.name, "lantern-browser");
  assert.equal(matched(projects, "browser")?.name, "lantern-browser");
});

test("a name inside a question is found", () => {
  assert.equal(matched(projects, "the lantern-browser repository")?.name, "lantern-browser");
});

test("nothing asked for is nothing found", () => {
  assert.equal(matched(projects, "   "), undefined);
  assert.equal(matched(projects, "nothing like it"), undefined);
});

test("what a project says it is, is its first real paragraph", () => {
  const said = opening([
    "# Kyuren",
    "",
    "![a badge](https://example.com/badge.svg)",
    "",
    "A desktop assistant that listens, remembers and does things.",
    "",
    "## Install",
  ].join("\n"));

  assert.equal(said, "A desktop assistant that listens, remembers and does things.");
});

test("a readme with nothing to say says nothing", () => {
  assert.equal(opening(""), undefined);
  assert.equal(opening("# Only a title\n"), undefined);
});

test("what was happening when work stopped is said in full", () => {
  const said = summarise({
    project: {
      name: "harbor-os",
      path: "/where/harbor-os",
      branch: "master",
      ahead: 0,
      behind: 0,
      dirty: 6,
      lastAt: new Date("2026-02-13T10:00:00Z").getTime(),
    },
    about: "an operating system written from nothing",
    lately: [
      { at: 1, said: "established foundation for pci io" },
      { at: 2, said: "added basic console" },
    ],
  });

  assert.match(said, /harbor-os is an operating system written from nothing/);
  assert.match(said, /Work stopped on 13 February 2026/);
  assert.match(said, /6 files uncommitted/);
  assert.match(said, /never pushed anywhere/);
  assert.match(said, /established foundation for pci io; added basic console/);
});

test("a project nobody has committed to says so", () => {
  const said = summarise({
    project: { name: "fresh", path: "/where/fresh", branch: "main", ahead: 0, behind: 0, dirty: 2 },
    lately: [],
  });

  assert.match(said, /Nothing has been committed yet/);
  assert.match(said, /2 files uncommitted/);
});

test("one of a thing is one, not ones", () => {
  const said = summarise({
    project: {
      name: "tidy",
      path: "/where/tidy",
      branch: "main",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      dirty: 1,
      lastAt: Date.now(),
    },
    lately: [],
  });

  assert.match(said, /1 file uncommitted/);
  assert.match(said, /1 commit unpushed/);
});
