import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLOSE, EVENING, OPEN } from "#brief/note.ts";
import { due, recapDay } from "#recap/evening.ts";
import type { Readers } from "#recap/gather.ts";

const readers: Readers = {
  projects: async () => [{ name: "kyuren", path: "/x/kyuren", branch: "main", ahead: 0, behind: 0, dirty: 0 }],
  commits: async () => ["feat: the evening recap"],
  merged: async () => [],
  made: async () => [],
  worked: async () => [],
};

test("the evening's recap is due from six, once a day", () => {
  assert.equal(due(new Date(2026, 9, 28, 17, 59), undefined), false);
  assert.equal(due(new Date(2026, 9, 28, 18, 0), undefined), true);
  assert.equal(due(new Date(2026, 9, 28, 23, 30), "2026-10-28"), false, "already written today");
  assert.equal(due(new Date(2026, 9, 29, 18, 0), "2026-10-28"), true, "the next evening");
  assert.equal(due(new Date(2026, 9, 29, 1, 0), "2026-10-28"), false, "not after midnight");
});

test("the recap is written into the day's note, under the morning's brief", async () => {
  const vault = mkdtempSync(join(tmpdir(), "kyuren-vault-"));
  await mkdir(join(vault, "days"));
  await writeFile(join(vault, "days", "2026-10-28.md"), `${OPEN}\n# Wednesday 28 October 2026\n${CLOSE}\n`);
  const { recap, note } = await recapDay(vault, new Date(2026, 9, 28, 18, 0), readers);
  assert.equal(note, join(vault, "days", "2026-10-28.md"));
  assert.deepEqual(recap.committed, [{ project: "kyuren", said: ["feat: the evening recap"] }]);
  const written = readFileSync(note, "utf8");
  assert.ok(written.indexOf(CLOSE) < written.indexOf(EVENING), "under the brief");
  assert.match(written, /- \*\*kyuren\*\*, 1 commit: feat: the evening recap/);
});
