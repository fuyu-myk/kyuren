import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { watchVault } from "#memory/watch.ts";

function vault(): string {
  return mkdtempSync(join(tmpdir(), "kyuren-watch-"));
}

/// Long enough for the operating system to actually be watching, and long enough for it to say
/// so afterwards. A change written before the watch has registered is a change nobody hears
/// about, and waiting for it forever is how this test used to hang instead of fail.
const REGISTERING = 250;
const PATIENCE = 5_000;

async function watching(): Promise<void> {
  await new Promise((ready) => setTimeout(ready, REGISTERING));
}

function awaiting(where: string): { changed: Promise<string[]>; stop: () => void } {
  let tell: (files: string[]) => void;
  const changed = new Promise<string[]>((resolve, reject) => {
    tell = resolve;
    setTimeout(
      () => reject(new Error("nothing was noticed within the time allowed")),
      PATIENCE,
    ).unref();
  });
  const watcher = watchVault(where, (files) => tell(files));
  return { changed, stop: watcher.stop };
}

test("a note written by anything at all is noticed", async () => {
  const where = vault();
  const waiting = awaiting(where);
  await watching();

  writeFileSync(join(where, "thought.md"), "# A thought\n\nSomething worth keeping.\n");
  assert.deepEqual(await waiting.changed, [join(where, "thought.md")],
    "a note is named by its full path, since two vaults may each hold one of this name");
  waiting.stop();
});

test("several writes in a row arrive as one change", async () => {
  const where = vault();
  const waiting = awaiting(where);
  await watching();

  // Editors write more than once when saving. Reindexing on each would read a half-written file.
  for (const line of ["one", "two", "three"]) {
    writeFileSync(join(where, "note.md"), `# Note\n\n${line}\n`);
  }

  assert.deepEqual(await waiting.changed, [join(where, "note.md")]);
  waiting.stop();
});

test("what is not a note is ignored", async () => {
  const where = vault();
  let woken = 0;
  const watcher = watchVault(where, () => { woken += 1; });
  await watching();

  writeFileSync(join(where, "picture.png"), "not markdown");
  writeFileSync(join(where, "data.json"), "{}");
  await new Promise((rest) => setTimeout(rest, 600));

  assert.equal(woken, 0, "a folder full of other files must not keep waking the index");
  watcher.stop();
});

test("watching a folder that is not there does not throw", () => {
  const watcher = watchVault(join(tmpdir(), "kyuren-nothing-here-at-all"), () => {});
  watcher.stop();
});
