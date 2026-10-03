import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { folderOf } from "#coding/where.ts";

test("a folder named for a path is read back as that path, dashes in names and all", async () => {
  const root = await mkdtemp(join(tmpdir(), "kyuren-where-"));
  await mkdir(join(root, "Code", "my-project"), { recursive: true });
  await mkdir(join(root, "Code", "kyuren"), { recursive: true });
  const encode = (path: string) => path.replace(/[^A-Za-z0-9]/g, "-");

  assert.equal(await folderOf(encode(join(root, "Code", "my-project"))), join(root, "Code", "my-project"));
  assert.equal(await folderOf(encode(join(root, "Code", "kyuren"))), join(root, "Code", "kyuren"));
  assert.equal(await folderOf(encode(join(root, "Code", "gone-away"))), undefined, "a folder since removed is not guessed at");
  assert.equal(await folderOf(`-${encode(join(root, "Code", "kyuren"))}--`), join(root, "Code", "kyuren"), "pi wraps the path in two dashes either side");
  await mkdir(join(root, "Code", "Jessie's Jetty"), { recursive: true });
  assert.equal(await folderOf(join(root, "Code", "Jessie's Jetty").replace(/[^A-Za-z0-9]/g, "-")), join(root, "Code", "Jessie's Jetty"), "spaces and apostrophes are dashes too");
});
