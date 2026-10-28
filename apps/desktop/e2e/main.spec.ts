import { expect, test, type Page } from "@playwright/test";

type Called = { cmd: string; args: Record<string, unknown> };

/// The main window has no preview harness, so Tauri's own channel is stood in for the way its
/// mocks stand in for it: an event goes to whoever listens, and every command called is kept. A
/// question, a playbook run or a repair is answered only by a stop, as a long one would be.
function standIn(): void {
  const callbacks = new Map<number, (data: unknown) => void>();
  const listening = new Map<string, number[]>();
  const called: Called[] = [];
  const waiting: Array<() => void> = [];
  const failed = { path: "/runs/research.md", startedAt: "2026-10-20T09:00:00Z", outcome: "failed" };
  const books = [{ name: "research", approved: true, pending: false, when: "a question to research", inputs: [] as unknown[], recent: [failed] }];
  let next = 1;
  Object.assign(window, {
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => callbacks.delete(id) },
    __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
      transformCallback: (callback: (data: unknown) => void) => {
        callbacks.set(next, callback);
        return next++;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (cmd: string, args: Record<string, unknown>) => {
        const event = args?.event as string;
        if (cmd === "plugin:event|listen") {
          listening.set(event, [...(listening.get(event) ?? []), args.handler as number]);
          return args.handler;
        }
        if (cmd === "plugin:event|unlisten") {
          listening.set(event, (listening.get(event) ?? []).filter((id) => id !== args.eventId));
          return null;
        }
        called.push({ cmd, args });
        if (cmd === "resolve_permission") return { matched: true, pending: 0 };
        if (cmd === "open_link") return null;
        if (cmd === "project_board") {
          const pull = (number: number, title: string, checks: string, draft = false) => ({ number, title, url: `https://github.com/someone/kyuren/pull/${number}`, draft, checks });
          const github = { repo: "someone/kyuren", branch: "main", main: "failing", count: 5, pulls: [pull(41, "Keep the shelf in SQLite", "passing"), pull(40, "Try the wake word", "pending", true), pull(38, "Hover after waking", "failing"), pull(37, "Older", "none")] };
          const decisions = {
            count: 4,
            latest: [
              { at: Date.now() - 5 * 60_000, kind: "choice", topic: "CI on notch", question: "Should the island speak up when a check fails?", said: "Board only" },
              { at: Date.now() - 2 * 3_600_000, kind: "plan", topic: "plan approved", said: "Move the shelf onto SQLite" },
            ],
          };
          const reviews = [{ repo: "someone/fractaldb", number: 31, title: "Bound batch decode memory", url: "https://github.com/someone/fractaldb/pull/31", author: "a-colleague", draft: false }];
          return { projects: [{ name: "kyuren", path: "/x/kyuren", branch: "main", upstream: "origin/main", ahead: 0, behind: 0, dirty: 0, lastAt: Date.now(), github, decisions }], reviews };
        }
        if (cmd === "playbooks_list") return { playbooks: books };
        if (cmd === "playbook_read") {
          const book = { name: "research", when: "a question to research", version: 1, author: "claude", approved: "2026-10-01", steps: ["Search the web."], proof: [], notes: [] };
          return { name: "research", approved: book, pending: undefined, diff: "" };
        }
        if (cmd === "ask" || cmd === "playbook_invoke" || cmd === "playbook_repair") {
          return new Promise((_, refuse) => waiting.push(() => refuse("stopped before it finished")));
        }
        if (cmd === "stop_turn") {
          for (const stop of waiting.splice(0)) stop();
          return { stopped: true };
        }
        throw new Error(`${cmd} has no answer here`);
      },
    },
    standIn: {
      listens: (event: string) => (listening.get(event) ?? []).length,
      emit: (event: string, payload: unknown) => {
        for (const id of listening.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
      },
      called: (cmd: string) => called.filter((one) => one.cmd === cmd),
      approve: (name: string) => books.push({ name, approved: true, pending: false, when: `a ${name}`, inputs: [], recent: [] }),
    },
  });
}

type StandIn = {
  listens: (event: string) => number;
  emit: (event: string, payload: unknown) => void;
  called: (cmd: string) => Called[];
  approve: (name: string) => void;
};

async function emit(page: Page, name: string, payload: unknown): Promise<void> {
  await page.evaluate(([event, data]) => (window as unknown as { standIn: StandIn }).standIn.emit(event, data), [name, payload] as const);
}

async function calledWith(page: Page, cmd: string): Promise<Called[]> {
  return page.evaluate((name) => (window as unknown as { standIn: StandIn }).standIn.called(name), cmd);
}

const answers = (page: Page) => calledWith(page, "resolve_permission");

const FIRST = { id: "q1", tool: "web_fetch", effect: "outbound", target: "https://example.com/one" };
const SECOND = { id: "q2", tool: "web_fetch", effect: "outbound", target: "https://example.com/two" };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(standIn);
  await page.goto("/index.html");
  await page.waitForFunction(() => (window as unknown as { standIn: StandIn }).standIn.listens("permission") > 0);
});

test("a question answered on the island is gone from the main window, and the one waiting behind it is shown", async ({ page }) => {
  await emit(page, "permission", FIRST);
  await emit(page, "permission", SECOND);
  await expect(page.locator(".asking code")).toHaveText(FIRST.target);
  await emit(page, "permission:answered", FIRST.id);
  await expect(page.locator(".asking code")).toHaveText(SECOND.target);
  await emit(page, "permission:answered", SECOND.id);
  await expect(page.locator(".asking")).toHaveCount(0);
  expect(await answers(page), "nothing was answered from here").toEqual([]);
});

test("a question answered in the main window is answered once, and the word that it was changes nothing more", async ({ page }) => {
  await emit(page, "permission", FIRST);
  await emit(page, "permission", SECOND);
  await page.locator(".asking").getByRole("button", { name: "allow" }).click();
  await expect(page.locator(".asking code")).toHaveText(SECOND.target);
  await emit(page, "permission:answered", FIRST.id);
  await page.locator(".asking").getByRole("button", { name: "deny" }).click();
  await expect(page.locator(".asking")).toHaveCount(0);
  expect((await answers(page)).map((one) => one.args)).toEqual([
    { id: FIRST.id, allow: true },
    { id: SECOND.id, allow: false },
  ]);
});

test("a question being waited on can be stopped, and ends as stopped rather than as trouble", async ({ page }) => {
  await page.locator(".composer textarea").fill("look into why the build fails");
  await page.getByRole("button", { name: "send" }).click();
  const stop = page.getByRole("button", { name: "stop" });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.getByRole("button", { name: "send" })).toBeVisible();
  const [asked] = await calledWith(page, "ask");
  expect(String(asked?.args.id)).toMatch(/^chat:/);
  expect((await calledWith(page, "stop_turn")).map((one) => one.args)).toEqual([{ id: asked?.args.id }]);
  await expect(page.getByText("stopped before it finished")).toHaveCount(0);
});

test("a playbook run by a slash is stopped by the name the window gave it", async ({ page }) => {
  await page.locator(".composer textarea").fill("/research diffusion models");
  await page.getByRole("button", { name: "send" }).click();
  await page.getByRole("button", { name: "stop" }).click();
  await expect(page.getByRole("button", { name: "send" })).toBeVisible();
  const [invoked] = await calledWith(page, "playbook_invoke");
  const [stopped] = await calledWith(page, "stop_turn");
  expect(String(invoked?.args.id)).toMatch(/^chat:/);
  expect(stopped?.args.id).toBe(invoked?.args.id);
  await expect(page.getByText("stopped before it finished")).toHaveCount(0);
});

test("a question being waited on is still there, and still stoppable, after going to another pane and back", async ({ page }) => {
  const rail = page.locator(".rail");
  await page.locator(".composer textarea").fill("look into why the build fails");
  await page.getByRole("button", { name: "send" }).click();
  await expect(page.getByRole("button", { name: "stop" })).toBeVisible();

  await rail.getByRole("button", { name: "research" }).click();
  await expect(page.getByRole("button", { name: "send" })).toBeVisible();
  await rail.getByRole("button", { name: "chat" }).click();

  await expect(page.getByText("look into why the build fails")).toBeVisible();
  const stop = page.getByRole("button", { name: "stop" });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.getByRole("button", { name: "send" })).toBeVisible();
  const [asked] = await calledWith(page, "ask");
  expect((await calledWith(page, "stop_turn")).map((one) => one.args)).toEqual([{ id: asked?.args.id }]);
});

test("a repair being waited on can be stopped by the name it was given, and ends as stopped rather than as trouble", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "system" }).click();
  const books = page.locator("section").filter({ has: page.locator("h3", { hasText: /^playbooks$/ }) });
  await books.getByRole("button", { name: "research", exact: true }).click();
  await books.getByRole("button", { name: "repair from the last run" }).click();
  await books.getByRole("button", { name: "stop repairing" }).click();
  await expect(books.getByRole("button", { name: "repair from the last run" })).toBeVisible();
  const [repaired] = await calledWith(page, "playbook_repair");
  expect(String(repaired?.args.id)).toMatch(/^repair:/);
  expect((await calledWith(page, "stop_turn")).map((one) => one.args)).toEqual([{ id: repaired?.args.id }]);
  await expect(page.getByText("stopped before it finished")).toHaveCount(0);
});

test("a playbook approved while another page was shown is offered by a slash on coming back", async ({ page }) => {
  const rail = page.locator(".rail");
  await rail.getByRole("button", { name: "system" }).click();
  await page.evaluate(() => (window as unknown as { standIn: StandIn }).standIn.approve("weekly"));
  await rail.getByRole("button", { name: "chat" }).click();
  await page.locator(".composer textarea").fill("/weekly the last seven days");
  await page.getByRole("button", { name: "send" }).click();
  await expect(page.getByRole("button", { name: "stop" })).toBeVisible();
  const [invoked] = await calledWith(page, "playbook_invoke");
  expect(invoked?.args.name).toBe("weekly");
  await expect(page.getByText("nothing is called /weekly")).toHaveCount(0);
});

test("a repair begun before leaving the page is still being waited on, and stoppable, on coming back", async ({ page }) => {
  const rail = page.locator(".rail");
  const books = page.locator("section").filter({ has: page.locator("h3", { hasText: /^playbooks$/ }) });
  await rail.getByRole("button", { name: "system" }).click();
  await books.getByRole("button", { name: "research", exact: true }).click();
  await books.getByRole("button", { name: "repair from the last run" }).click();
  await rail.getByRole("button", { name: "chat" }).click();
  await rail.getByRole("button", { name: "system" }).click();
  await books.getByRole("button", { name: "research", exact: true }).click();
  await books.getByRole("button", { name: "stop repairing" }).click();
  await expect(books.getByRole("button", { name: "repair from the last run" })).toBeVisible();
  const [repaired] = await calledWith(page, "playbook_repair");
  expect((await calledWith(page, "playbook_repair")).length, "not begun a second time").toBe(1);
  expect((await calledWith(page, "stop_turn")).map((one) => one.args)).toEqual([{ id: repaired?.args.id }]);
});

test("the board shows a project's main branch checks and its open pull requests, each opening on GitHub", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "development and projects" }).click();
  const project = page.locator(".board > li", { hasText: "kyuren" });
  await expect(project.locator(".ci.failing")).toHaveText("main failing");
  await expect(project.locator(".pull .title")).toHaveText(["Keep the shelf in SQLite", "Try the wake word", "Hover after waking"]);
  await expect(project.locator(".pull .checks")).toHaveClass([/passing/, /pending/, /failing/]);
  await expect(project.locator(".pull .draft")).toHaveText(["draft"]);
  await expect(project.locator(".pulls .others")).toHaveText("2 more open");
  await project.locator(".pull", { hasText: "Hover after waking" }).click();
  const opened = await page.evaluate(() => (window as unknown as { standIn: { called: (cmd: string) => Array<{ args: Record<string, unknown> }> } }).standIn.called("open_link").map((one) => one.args.url));
  expect(opened).toEqual(["https://github.com/someone/kyuren/pull/38"]);
});

test("the board shows what was decided about a project on the island, latest first, the rest counted", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "development and projects" }).click();
  const decided = page.locator(".board > li", { hasText: "kyuren" }).locator(".decided");
  await expect(decided.locator(".topic")).toHaveText(["CI on notch", "plan approved"]);
  await expect(decided.locator(".said")).toHaveText(["Board only", "Move the shelf onto SQLite"]);
  await expect(decided.locator("li").first()).toHaveAttribute("title", "Should the island speak up when a check fails?");
  await expect(decided.locator(".others")).toHaveText("2 decided before");
});

test("the board lists the pull requests waiting on the user's review, above every project, each opening on GitHub", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "development and projects" }).click();
  const waiting = page.locator(".reviews");
  await expect(waiting.locator("h4")).toHaveText("waiting on your review");
  await expect(waiting.locator(".pull")).toHaveText(["someone/fractaldb#31Bound batch decode memoryby a-colleague"]);
  await waiting.locator(".pull").click();
  const opened = await page.evaluate(() => (window as unknown as { standIn: { called: (cmd: string) => Array<{ args: Record<string, unknown> }> } }).standIn.called("open_link").map((one) => one.args.url));
  expect(opened).toEqual(["https://github.com/someone/fractaldb/pull/31"]);
});
