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
