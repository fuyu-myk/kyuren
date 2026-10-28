import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.KYUREN_HOME = mkdtempSync(join(tmpdir(), "kyuren-notion-"));
const { chooseTodos, databases, places, remember, todosDatabase } = await import("#connect/notion/places.ts");

test("the database chosen for todos may be written, and one chosen before goes back to being read", () => {
  remember([{ id: "a", title: "Tasks" }, { id: "b", title: "Reading" }]);
  assert.equal(todosDatabase(), undefined);
  chooseTodos("a");
  assert.equal(todosDatabase()?.title, "Tasks");
  assert.deepEqual(places().map((one) => one.mode), ["write", "read"]);
  chooseTodos("b");
  assert.deepEqual(databases().map((one) => [one.id, one.mode]), [["a", "read"], ["b", "write"]]);
  remember([{ id: "c", title: "New" }]);
  assert.equal(todosDatabase()?.id, "b", "finding more databases keeps the choice");
  chooseTodos(null);
  assert.equal(todosDatabase(), undefined);
  assert.deepEqual(databases().map((one) => one.mode), ["read", "read", "read"]);
  assert.throws(() => chooseTodos("unknown"), /not a known database/);
});
