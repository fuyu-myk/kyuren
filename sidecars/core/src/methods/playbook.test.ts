import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Gate } from "#permission/gate.ts";

const BOOK = `---
name: weekly-review
when: the user asks for a weekly review
version: 1
---

## Steps

1. Recall the week.

## Proof

1. file exists: ~/reviews/{{week}}.md
`;

test("one playbook that does not read is not every playbook gone from the list", async () => {
  const home = await mkdtemp(join(tmpdir(), "kyuren-home-"));
  process.env.KYUREN_HOME = home;
  await mkdir(join(home, "playbooks", "pending"), { recursive: true });
  await writeFile(join(home, "playbooks", "weekly-review.md"), BOOK);
  await writeFile(join(home, "playbooks", "tidy-notes.md"), BOOK.replace("name: weekly-review", "name: Tidy Notes"));
  // Imported once the home is set, since the stores find their folders as they load.
  const { playbookHandlers } = await import("#methods/playbook.ts");
  const handlers = playbookHandlers(new Gate(() => [], () => undefined), async () => "deny", join(home, "vault"));
  const listed = await handlers["playbook.list"]();
  assert.deepEqual(listed.playbooks.map((one) => one.name), ["tidy-notes", "weekly-review"]);
});
