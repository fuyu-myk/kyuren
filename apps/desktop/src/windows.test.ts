import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "..");
const TAURI = join(DESKTOP, "src-tauri");

/// The page each window loads, from which everything it runs is imported.
const ENTRIES: Record<string, string> = {
  main: "src/main.tsx",
  island: "src/island/main.tsx",
  mind: "src/mind/main.ts",
};

const IMPORT = /(?:import|export)\s+(type\s+)?[^"';]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;
const CALL = /\b(?:invoke|command)\s*(?:<[^()]*?>)?\(\s*"([a-z_]+)"/g;

function file(base: string): string | undefined {
  return [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")].find(
    (one) => existsSync(one) && statSync(one).isFile(),
  );
}

function resolved(spec: string, from: string): string | undefined {
  if (spec.startsWith("@/")) return file(join(DESKTOP, "src", spec.slice(2)));
  if (spec.startsWith(".")) return file(join(dirname(from), spec));
  return undefined;
}

/// The commands a window's code can call: every literal command name in what its page imports.
function calledBy(entry: string): Set<string> {
  const seen = new Set<string>();
  const waiting = [join(DESKTOP, entry)];
  const called = new Set<string>();
  while (waiting.length > 0) {
    const at = waiting.pop() as string;
    if (seen.has(at)) continue;
    seen.add(at);
    const text = readFileSync(at, "utf8");
    for (const found of text.matchAll(IMPORT)) {
      if (found[1]) continue;
      const to = resolved(found[2] ?? found[3] ?? found[4] ?? "", at);
      if (to && /\.tsx?$/.test(to)) waiting.push(to);
    }
    for (const found of text.matchAll(CALL)) called.add(found[1] as string);
  }
  return called;
}

type Capability = { windows: string[]; permissions: string[] };

function capabilities(): Capability[] {
  const folder = join(TAURI, "capabilities");
  return readdirSync(folder)
    .filter((one) => one.endsWith(".json"))
    .map((one) => JSON.parse(readFileSync(join(folder, one), "utf8")) as Capability);
}

/// The app's own commands a window is granted, by command name.
function grantedTo(window: string): Set<string> {
  return new Set(
    capabilities()
      .filter((one) => one.windows.includes(window))
      .flatMap((one) => one.permissions)
      .filter((one) => one.startsWith("allow-"))
      .map((one) => one.slice("allow-".length).replaceAll("-", "_")),
  );
}

function registered(): Set<string> {
  const lib = readFileSync(join(TAURI, "src/lib.rs"), "utf8");
  const handler = /generate_handler!\[([\s\S]*?)\]/.exec(lib)?.[1] ?? "";
  return new Set([...handler.matchAll(/\b[a-z_]+::([a-z_]+)/g)].map((one) => one[1] as string));
}

function declared(): Set<string> {
  const build = readFileSync(join(TAURI, "build.rs"), "utf8");
  const list = /const COMMANDS: &\[&str\] = &\[([\s\S]*?)\];/.exec(build)?.[1] ?? "";
  return new Set([...list.matchAll(/"([a-z_]+)"/g)].map((one) => one[1] as string));
}

const sorted = (set: Set<string>) => [...set].sort();

test("every command the app registers is declared, so each is a permission a window must be granted", () => {
  assert.ok(registered().size > 0, "the commands were found where they are registered");
  assert.deepEqual(sorted(declared()), sorted(registered()));
});

test("every window may call exactly the commands its own code calls, and the reader none", () => {
  for (const [window, entry] of Object.entries(ENTRIES)) {
    const called = calledBy(entry);
    assert.ok(called.size > 0, `${window}'s calls were found`);
    for (const one of called) assert.ok(registered().has(one), `${window} calls ${one}, which is not a command`);
    assert.deepEqual(sorted(grantedTo(window)), sorted(called), window);
  }
  assert.equal(grantedTo("reader").size, 0, "a page read on the web reaches nothing in Kyuren");
  for (const one of capabilities()) {
    for (const window of one.windows) assert.ok(window in ENTRIES, `${window} is not one of Kyuren's windows`);
  }
});

test("a window only listens for events, and is given nothing of Tauri's own beyond what it uses", () => {
  for (const one of capabilities()) {
    assert.ok(!one.permissions.includes("core:default"), `${one.windows.join()} holds all of core`);
    for (const permission of one.permissions.filter((one) => one.startsWith("core:event:"))) {
      // An event a window raised would be taken for the app's own, as the one that starts listening is.
      assert.ok(permission === "core:event:allow-listen" || permission === "core:event:allow-unlisten", permission);
    }
  }
});
