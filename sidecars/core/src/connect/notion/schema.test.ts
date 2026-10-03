import assert from "node:assert/strict";
import { test } from "node:test";
import { dateProperty, finishedNames, titleProperty } from "#connect/notion/schema.ts";

const assignments = {
  Name: { type: "title" },
  Type: { type: "select" },
  "Due Date": { type: "date" },
  Status: {
    type: "status",
    status: {
      options: [
        { id: "a", name: "Not started" },
        { id: "b", name: "In progress" },
        { id: "c", name: "Handed in" },
      ],
      groups: [
        { name: "To-do", option_ids: ["a"] },
        { name: "In progress", option_ids: ["b"] },
        { name: "Complete", option_ids: ["c"] },
      ],
    },
  },
};

test("the date property is found by type, not by name", () => {
  assert.equal(dateProperty(assignments), "Due Date");
  assert.equal(titleProperty(assignments), "Name");
});

test("a database with no date property reports none", () => {
  assert.equal(dateProperty({ Name: { type: "title" } }), undefined);
});

test("finished means the Complete group, whatever the option is called", () => {
  const finished = finishedNames(assignments);
  assert.ok(finished.has("Handed in"), "a renamed Complete option still means finished");
  assert.ok(!finished.has("In progress"));
  assert.ok(!finished.has("Not started"));
});

test("a database without a status property has nothing finished", () => {
  assert.equal(finishedNames({ Date: { type: "date" } }).size, 0);
});
