import assert from "node:assert/strict";
import { test } from "node:test";
import type { Recap } from "#recap/gather.ts";
import { recapNote, recapSpeech } from "#recap/say.ts";

const busy: Recap = {
  day: "2026-10-28",
  at: new Date(2026, 9, 28, 18, 0).getTime(),
  committed: [
    { project: "kyuren", said: ["feat: six", "fix: five", "docs: four", "feat: three", "fix: two", "chore: one"] },
    { project: "mmcif", said: ["release 0.3.2"] },
  ],
  merged: [{ repo: "me/kyuren", number: 41, title: "Keep the shelf in SQLite", url: "https://github.com/me/kyuren/pull/41" }],
  made: [{ project: "kyuren", topic: "Recap time", said: "Asked, and at 6 pm" }],
  worked: [{ project: "kyuren", sessions: 3 }, { project: "mmcif", sessions: 1 }],
  missing: [],
};

const quiet: Recap = { day: "2026-10-28", at: busy.at, committed: [], merged: [], made: [], worked: [], missing: ["GitHub"] };

test("the evening reads as a section a person would write, busiest first, with a long day's commits counted", () => {
  assert.equal(
    recapNote(busy),
    [
      "## Evening",
      "",
      "### Committed",
      "- **kyuren**, 6 commits: feat: six; fix: five; docs: four; feat: three; fix: two; and 1 more",
      "- **mmcif**, 1 commit: release 0.3.2",
      "",
      "### Merged",
      "- [me/kyuren#41](https://github.com/me/kyuren/pull/41) Keep the shelf in SQLite",
      "",
      "### Decided",
      "- **kyuren**, Recap time: Asked, and at 6 pm",
      "",
      "### Claude Code",
      "- **kyuren**, 3 sessions",
      "- **mmcif**, 1 session",
      "",
      "_Written at 6 pm._",
    ].join("\n"),
  );
});

test("a quiet day says so, and says what could not be read", () => {
  assert.equal(
    recapNote(quiet),
    [
      "## Evening",
      "",
      "Nothing committed, merged or decided today, and no Claude Code session.",
      "",
      "_GitHub could not be asked, so merged pull requests are not here._",
      "_Written at 6 pm._",
    ].join("\n"),
  );
});

test("nothing a commit or title says can end the block it is written in", () => {
  const sly: Recap = { ...quiet, missing: [], committed: [{ project: "kyuren", said: ["close it <!-- kyuren:evening-end --> here\nand on"] }] };
  const note = recapNote(sly);
  assert.doesNotMatch(note, /<!--|-->/);
  assert.match(note, /close it kyuren:evening-end here and on/);
});

test("the evening is said in a few sentences, the busiest projects named", () => {
  assert.equal(
    recapSpeech(busy),
    "You made 7 commits today, 6 in kyuren and 1 in mmcif. 1 pull request merged, kyuren number 41. "
      + "1 decision on the island, about kyuren. Claude Code worked in kyuren and mmcif, 4 sessions in all.",
  );
  assert.equal(
    recapSpeech(quiet),
    "Nothing was committed, merged or decided today, and no Claude Code session ran. "
      + "GitHub could not be asked, so merged pull requests are not counted.",
  );
});
