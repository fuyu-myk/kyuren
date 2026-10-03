import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listDirectory, readFile } from "#agent/tools.ts";
import { classify } from "#permission/action.ts";

test("a link is judged, and read, as what it leads to, so a secret cannot be read under another name", async () => {
  const folder = mkdtempSync(join(tmpdir(), "kyuren-tools-"));
  try {
    writeFileSync(join(folder, ".env"), "KEY=value\n");
    symlinkSync(join(folder, ".env"), join(folder, "notes.txt"));
    const described = readFile.describe({ path: join(folder, "notes.txt") });
    assert.equal(described.target, realpathSync(join(folder, ".env")));
    assert.equal(classify(described, []), "ask");
    assert.equal(await readFile.run({ path: join(folder, "notes.txt") }, new AbortController().signal), "KEY=value\n");

    symlinkSync(folder, join(folder, "elsewhere"));
    assert.equal(listDirectory.describe({ path: join(folder, "elsewhere") }).target, realpathSync(folder));
    assert.equal(readFile.describe({ path: join(folder, "missing.md") }).target, join(folder, "missing.md"),
      "a path that leads nowhere yet is judged as written");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a path spelled with letters the disk folds together is judged as the file it opens", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "kyuren-tools-"));
  try {
    writeFileSync(join(folder, "id_rsa"), "key\n");
    const folded = join(folder, "ID_RſA");
    if (!existsSync(folded)) {
      t.skip("this disk tells the two spellings apart");
      return;
    }
    assert.equal(classify(readFile.describe({ path: folded }), []), "ask");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a link is judged by its own name as well as by the file it opens", () => {
  const folder = mkdtempSync(join(tmpdir(), "kyuren-tools-"));
  try {
    mkdirSync(join(folder, "shared"));
    mkdirSync(join(folder, "app"));
    writeFileSync(join(folder, "shared/production-settings"), "KEY=value\n");
    symlinkSync(join(folder, "shared/production-settings"), join(folder, "app/.env"));
    const described = readFile.describe({ path: join(folder, "app/.env") });
    assert.equal(described.target, realpathSync(join(folder, "shared/production-settings")));
    assert.equal(described.through, join(folder, "app/.env"));
    assert.equal(classify(described, []), "ask");
    writeFileSync(join(folder, "plain.md"), "plain\n");
    assert.equal(readFile.describe({ path: realpathSync(join(folder, "plain.md")) }).through, undefined, "nothing to add when it opens itself");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
