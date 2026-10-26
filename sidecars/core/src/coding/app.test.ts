import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appLink } from "#coding/app.ts";

const OPEN = "local_a08a89ff-b82d-4937-8053-f79500215283";
const SHELVED = "local_397f28e0-a1f9-45c4-befa-c1f73e3ddadb";

async function records(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kyuren-app-"));
  const kept = join(dir, "5de2a04d", "76a3c821");
  await mkdir(kept, { recursive: true });
  await writeFile(join(kept, `${OPEN}.json`), JSON.stringify({ sessionId: OPEN, cliSessionId: "c7e753b3", isArchived: false, title: "Island work" }));
  await writeFile(join(kept, `${SHELVED}.json`), JSON.stringify({ sessionId: SHELVED, cliSessionId: "old", isArchived: true }));
  await writeFile(join(kept, "local_broken.json"), "{ not json");
  await writeFile(join(kept, "local_odd.json"), JSON.stringify({ sessionId: "local_../../etc", cliSessionId: "odd" }));
  return dir;
}

test("a Claude Code session the Claude app keeps is opened by the app's own link to it", async () => {
  const dir = await records();
  assert.equal(await appLink(dir, "c7e753b3"), `claude://claude.ai/epitaxy/${OPEN}`);
});

test("a session the app has archived, has no record of, or keeps an odd record of, has no link", async () => {
  const dir = await records();
  assert.equal(await appLink(dir, "old"), undefined, "archived");
  assert.equal(await appLink(dir, "unknown"), undefined);
  assert.equal(await appLink(dir, "odd"), undefined, "an id not shaped as the app's own");
  assert.equal(await appLink(join(dir, "missing"), "c7e753b3"), undefined, "no app");
});
