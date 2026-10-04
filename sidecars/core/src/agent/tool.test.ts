import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Action } from "#permission/action.ts";
import { Gate } from "#permission/gate.ts";
import { invoke, type Tool } from "#agent/tool.ts";

type Write = { path: string; text: string };

const writeFile: Tool<Write> = {
  name: "write_file",
  description: "writes text to a path",
  describe: (args) => ({ tool: "write_file", effect: "write", target: args.path }),
  run: async (args) => {
    writeFileSync(args.path, args.text, "utf8");
    return { written: args.path };
  },
};

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "kyuren-gate-"));
  const vault = join(dir, "vault");
  writeFileSync(join(dir, "marker"), "");
  return { dir, vault, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function gateFor(vault: string) {
  return new Gate(() => [{ path: vault, mode: "write" }], () => {});
}

test("a denied tool call does not run: the file is never created", async () => {
  const { dir, vault, cleanup } = scratch();
  try {
    const target = join(dir, "outside-the-vault.txt");
    const outcome = await invoke(
      writeFile,
      { path: target, text: "should never be written" },
      gateFor(vault),
      async () => "deny",
      new AbortController().signal,
    );

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.refused, true);
    assert.equal(existsSync(target), false, "a refused write must leave nothing behind");
  } finally {
    cleanup();
  }
});

test("an approved call does run", async () => {
  const { dir, vault, cleanup } = scratch();
  try {
    const target = join(dir, "approved.txt");
    const outcome = await invoke(
      writeFile,
      { path: target, text: "approved" },
      gateFor(vault),
      async () => "allow",
      new AbortController().signal,
    );

    assert.equal(outcome.ok, true);
    assert.equal(readFileSync(target, "utf8"), "approved");
  } finally {
    cleanup();
  }
});

test("approving one path does not let a second path through unasked", async () => {
  const { dir, vault, cleanup } = scratch();
  try {
    const gate = gateFor(vault);
    const asked: string[] = [];
    const ask = async (action: Action) => {
      asked.push(action.target);
      return "allow" as const;
    };

    await invoke(writeFile, { path: join(dir, "a.txt"), text: "a" }, gate, ask, new AbortController().signal);
    await invoke(writeFile, { path: join(dir, "a.txt"), text: "again" }, gate, ask, new AbortController().signal);
    await invoke(writeFile, { path: join(dir, "b.txt"), text: "b" }, gate, ask, new AbortController().signal);

    assert.equal(asked.length, 2, "the repeat should be remembered, the new path should not be");
    assert.deepEqual(asked, [join(dir, "a.txt"), join(dir, "b.txt")]);
  } finally {
    cleanup();
  }
});

test("a cancelled call never starts", async () => {
  const { dir, vault, cleanup } = scratch();
  try {
    const target = join(dir, "cancelled.txt");
    const controller = new AbortController();
    controller.abort();

    const outcome = await invoke(
      writeFile,
      { path: target, text: "nope" },
      gateFor(vault),
      async () => "allow",
      controller.signal,
    );

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.refused, false, "cancelling is not a refusal");
    assert.equal(existsSync(target), false);
  } finally {
    cleanup();
  }
});

test("interrupting a running tool reports cancellation rather than an error", async () => {
  const { vault, cleanup } = scratch();
  try {
    const controller = new AbortController();
    const slow: Tool<Record<string, never>> = {
      name: "slow",
      description: "waits",
      describe: () => ({ tool: "slow", effect: "execute", target: "wait" }),
      run: (_args, signal) =>
        new Promise((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("should have been cancelled")), 2000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        }),
    };

    const running = invoke(slow, {}, gateFor(vault), async () => "allow", controller.signal);
    setTimeout(() => controller.abort(), 20);
    const outcome = await running;

    assert.equal(outcome.ok, false);
    assert.equal(outcome.ok === false && outcome.refused, false);
    assert.match(outcome.ok === false ? outcome.reason : "", /cancelled/);
  } finally {
    cleanup();
  }
});

test("the gate survives an interrupted call and keeps deciding", async () => {
  const { dir, vault, cleanup } = scratch();
  try {
    const gate = gateFor(vault);
    const controller = new AbortController();
    controller.abort();

    await invoke(writeFile, { path: join(dir, "x.txt"), text: "x" }, gate, async () => "allow", controller.signal);

    const after = await invoke(
      writeFile,
      { path: join(dir, "y.txt"), text: "y" },
      gate,
      async () => "allow",
      new AbortController().signal,
    );
    assert.equal(after.ok, true, "an interrupted call must not poison later ones");
    assert.equal(readFileSync(join(dir, "y.txt"), "utf8"), "y");
  } finally {
    cleanup();
  }
});

test("writing a file makes the folders on the way to it", async () => {
  const { mkdtemp, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeFile } = await import("#agent/tools.ts");
  const dir = await mkdtemp(join(tmpdir(), "kyuren-write-"));
  const path = join(dir, "reviews", "2026-W38.md");
  await writeFile.run({ path, text: "# Week 38\n" }, new AbortController().signal);
  assert.equal(await readFile(path, "utf8"), "# Week 38\n");
});

test("a tilde means the home folder, in what is written and in what the gate is told", async () => {
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const { at, writeFile } = await import("#agent/tools.ts");
  assert.equal(at("~/.kyuren/vault/x.md"), join(homedir(), ".kyuren", "vault", "x.md"));
  assert.equal(at("~"), homedir());
  assert.equal(at("/tmp/x"), "/tmp/x");
  assert.equal(writeFile.describe({ path: "~/notes/a.md", text: "" }).target, join(homedir(), "notes", "a.md"));
});

const ENGINE = "https://engine.example";

const recall: Tool<{ question: string }> = {
  name: "remember",
  description: "recalls notes",
  notes: true,
  describe: (args) => ({ tool: "remember", effect: "read", target: args.question }),
  run: async () => ({ found: "the note" }),
};

const search: Tool<{ query: string }> = {
  name: "web_search",
  description: "searches the web",
  describe: (args) => ({ tool: "web_search", effect: "outbound", target: ENGINE, carrying: args.query }),
  run: async () => ({ results: [] }),
};

test("a turn that has read the user's notes asks before anything leaves, whatever was approved before", async () => {
  const gate = new Gate(() => [{ path: "/Users/someone/vault", mode: "write" }], () => {});
  gate.remember({ tool: "web_search", effect: "outbound", target: ENGINE }, "allow");
  const asked: Array<[string, string | undefined]> = [];
  const ask = async (action: Action, why?: string) => {
    asked.push([action.carrying ?? action.target, why]);
    return "deny" as const;
  };
  const exposure = { held: false };
  const signal = new AbortController().signal;

  assert.equal((await invoke(search, { query: "weather" }, gate, ask, signal, exposure)).ok, true, "before any notes, the yes given earlier stands");
  assert.equal((await invoke(recall, { question: "what did I write" }, gate, ask, signal, exposure)).ok, true);
  assert.equal(exposure.held, true);
  assert.equal((await invoke(search, { query: "the note" }, gate, ask, signal, exposure)).ok, false);
  assert.deepEqual(asked, [["the note", "this conversation has read your notes"]]);
  assert.equal(gate.decide({ tool: "web_search", effect: "outbound", target: ENGINE }).verdict, "allow", "a no given then is not kept");
});

test("a read inside a vault leaves the turn holding the user's notes, and a read elsewhere does not", async () => {
  const { dir, vault, cleanup } = scratch();
  try {
    const reading: Tool<{ path: string }> = {
      name: "read_file",
      description: "reads a file",
      describe: (args) => ({ tool: "read_file", effect: "read", target: args.path }),
      run: async () => "text",
    };
    const gate = gateFor(vault);
    const signal = new AbortController().signal;
    const elsewhere = { held: false };
    await invoke(reading, { path: join(dir, "marker") }, gate, async () => "deny", signal, elsewhere);
    assert.equal(elsewhere.held, false);
    const inside = { held: false };
    await invoke(reading, { path: join(vault, "journal.md") }, gate, async () => "deny", signal, inside);
    assert.equal(inside.held, true);
  } finally {
    cleanup();
  }
});

test("on the cloud, a read of the user's notes is asked about first, since what it reads goes to the model", async () => {
  const gate = new Gate(() => [{ path: "/Users/someone/vault", mode: "write" }], () => {});
  const asked: Array<string | undefined> = [];
  let answer: "allow" | "deny" = "deny";
  const ask = async (_action: Action, why?: string) => {
    asked.push(why);
    return answer;
  };
  const exposure = { held: false, cloud: true };
  const signal = new AbortController().signal;
  const refused = await invoke(recall, { question: "what did I write" }, gate, ask, signal, exposure);
  assert.equal(refused.ok, false);
  assert.equal(exposure.held, false, "nothing was read, so nothing is held");
  answer = "allow";
  assert.equal((await invoke(recall, { question: "what did I write" }, gate, ask, signal, exposure)).ok, true);
  assert.equal(exposure.held, true);
  assert.deepEqual(asked, ["what it reads would go to the cloud model", "what it reads would go to the cloud model"]);
  const local = { held: false, cloud: false };
  await invoke(recall, { question: "what did I write" }, gate, ask, signal, local);
  assert.equal(asked.length, 2, "on this machine a read of notes asks nobody");
});

type Reach = { first: boolean };

const reach: Tool<Reach> = {
  name: "skill",
  description: "reaches a host",
  describe: (args) => ({
    tool: "skill",
    effect: "outbound",
    target: "https://api.example.com",
    ...(args.first ? { first: "weather_now has not been used since it was approved" } : {}),
  }),
  run: async () => ({ reached: true }),
};

function hostAllowed(): Gate {
  const gate = new Gate(() => [], () => {});
  gate.remember({ tool: "skill", effect: "outbound", target: "https://api.example.com" }, "allow");
  return gate;
}

test("the first use of something newly approved is asked about, and says why, whatever its host was allowed", async () => {
  const gate = hostAllowed();
  const whys: Array<string | undefined> = [];
  const ask = async (_action: Action, why?: string) => {
    whys.push(why);
    return "allow" as const;
  };
  const signal = new AbortController().signal;

  assert.equal((await invoke(reach, { first: true }, gate, ask, signal)).ok, true);
  assert.deepEqual(whys, ["weather_now has not been used since it was approved"]);
  assert.equal((await invoke(reach, { first: false }, gate, ask, signal)).ok, true);
  assert.equal(whys.length, 1, "once it has been used, what its host was allowed stands");
});

test("a no to a first use refuses that call alone, and what its host was allowed still stands", async () => {
  const gate = hostAllowed();
  const signal = new AbortController().signal;

  const refused = await invoke(reach, { first: true }, gate, async () => "deny", signal);
  assert.equal(refused.ok === false && refused.refused, true);
  assert.equal(gate.decide({ tool: "skill", effect: "outbound", target: "https://api.example.com" }).verdict, "allow");
});
