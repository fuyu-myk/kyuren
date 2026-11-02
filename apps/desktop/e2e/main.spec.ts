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
  const weather = { id: "s1", name: "weather_now", about: "The weather where asked.", method: "GET", url: "https://api.example.com/weather", parameters: [{ name: "q", in: "query", kind: "string", required: true, about: "the place" }], recent: { q: ["Singapore", "Oslo"] }, headers: {}, auth: { mode: "bearer", credential: "weather" }, reads: "json", state: "approved", drafted: Date.now() };
  const moved = {
    ...weather, id: "s2", name: "tides_today", about: "The tides today.", url: "https://api.example.com/v2/tides", auth: { mode: "none" }, state: "pending",
    before: { ...weather, about: "The tides today.", url: "https://api.example.com/v1/tides", auth: { mode: "none" } }, why: "the API moved to v2",
  };
  let keys: string[] = [];
  let expired = ["google"];
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
        if (cmd === "project_session") return { started: true };
        if (cmd === "island_tabs") return ["voice", "week"];
        if (cmd === "island_widgets") return [];
        if (cmd === "island_home") return null;
        if (cmd === "island_week_starts") return "sunday";
        if (cmd === "island_week_starts_set") return args.starts;
        if (cmd === "skills_list") return { skills: [weather, moved] };
        if (cmd === "skill_keys_held") return (args.names as string[]).filter((name) => keys.includes(name));
        if (cmd === "store_secret") {
          keys = [...keys, String(args.name).replace(/^skill:/, "")];
          return [];
        }
        if (cmd === "forget_secret") {
          keys = keys.filter((name) => `skill:${name}` !== args.name);
          return [];
        }
        if (cmd === "held_secrets") return ["google"];
        if (cmd === "expired_connections") return expired;
        if (cmd === "connect_service") {
          expired = [];
          return null;
        }
        if (cmd === "island_visualizer") return false;
        if (cmd === "island_visualizer_set") return args.on;
        if (cmd === "notion_todos" || cmd === "notion_todos_choose") {
          const chosen = cmd === "notion_todos_choose" && args.id ? { chosen: args.id } : {};
          return { connected: true, databases: [{ id: "db1", title: "Tasks" }, { id: "db2", title: "Reading" }], ...chosen };
        }
        if (cmd === "evening_recap") {
          return { facts: "## Evening\n\n### Committed\n- **kyuren**, 1 commit: feat: the evening recap\n\n_Written at 6 pm._", note: "/vault/days/2026-10-28.md" };
        }
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

test("up and down bring back what this session sent, give back what was being written, and a new session has none", async ({ page }) => {
  const box = page.locator(".composer textarea");
  for (const said of ["first question", "second question"]) {
    await box.fill(said);
    await page.getByRole("button", { name: "send" }).click();
    await page.getByRole("button", { name: "stop" }).click();
    await expect(page.getByRole("button", { name: "send" })).toBeVisible();
  }
  await box.fill("half a th");
  await box.press("ArrowUp");
  await expect(box).toHaveValue("second question");
  await box.press("ArrowUp");
  await expect(box).toHaveValue("first question");
  await box.press("ArrowUp");
  await expect(box).toHaveValue("first question");
  await box.press("ArrowDown");
  await expect(box).toHaveValue("second question");
  await box.press("ArrowDown");
  await expect(box).toHaveValue("half a th");

  await page.getByRole("button", { name: "back" }).click();
  await box.fill("");
  await box.press("ArrowUp");
  await expect(box).toHaveValue("");
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

test("a project on the board opens a new session in the Claude app, there or to fix the checks that fail", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "development and projects" }).click();
  const project = page.locator(".board > li", { hasText: "kyuren" });
  await expect(project.locator(".pulls .fix")).toHaveCount(1);
  await project.locator(".project").hover();
  await project.getByRole("button", { name: "new session" }).click();
  await project.getByRole("button", { name: "fix main" }).click();
  await project.locator(".pulls li", { hasText: "Hover after waking" }).getByRole("button", { name: "fix" }).click();
  expect((await calledWith(page, "project_session")).map((one) => one.args)).toEqual([
    { path: "/x/kyuren", prompt: null },
    {
      path: "/x/kyuren",
      prompt: "The checks on the newest commit of someone/kyuren's default branch are failing on GitHub (https://github.com/someone/kyuren/commits). Find out why and fix them.",
    },
    {
      path: "/x/kyuren",
      prompt: "The checks on pull request #38 in someone/kyuren are failing on GitHub (https://github.com/someone/kyuren/pull/38/checks). Find out why and fix them on its branch.",
    },
  ]);
  expect(await calledWith(page, "open_link"), "a fix opens a session, not the pull request").toEqual([]);
});

test("the evening's recap is written on asking from the system pane, and shown there", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "system" }).click();
  await page.getByRole("button", { name: "how did today go" }).click();
  await expect(page.locator(".facts.recap")).toContainText("- **kyuren**, 1 commit: feat: the evening recap");
  expect(await calledWith(page, "evening_recap")).toHaveLength(1);
});

test("a connection whose grant expired says so, and is connected again with the client already held", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "system" }).click();
  const google = page.locator(".connections .connected", { hasText: "google" });
  await expect(google).toContainText("google access has expired");
  await google.getByRole("button", { name: "connect again" }).click();
  expect((await calledWith(page, "connect_service")).map((one) => one.args)).toEqual([{ service: "google", clientId: "" }]);
  await emit(page, "connections", ["google"]);
  await expect(google).toContainText("google is connected");
  await expect(google.getByRole("button", { name: "connect again" })).toHaveCount(0);
});

test("the island's week begins on Sunday, or on Monday once chosen in settings", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "system" }).click();
  const begins = page.getByRole("combobox", { name: "the week begins on" });
  await expect(begins).toHaveValue("sunday");
  await begins.selectOption("monday");
  expect((await calledWith(page, "island_week_starts_set")).map((one) => one.args)).toEqual([{ starts: "monday" }]);
  await expect(begins).toHaveValue("monday");
});



test("the music widget draws the music once switched on in settings, and the settings follow a click on the cover", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "system" }).click();
  const drawn = page.getByRole("combobox", { name: "under the now playing widget, draw" });
  await expect(drawn).toHaveValue("nothing");
  await drawn.selectOption("music");
  expect((await calledWith(page, "island_visualizer_set")).map((one) => one.args)).toEqual([{ on: true }]);
  await expect(drawn).toHaveValue("music");
  await emit(page, "island:visualizer", false);
  await expect(drawn).toHaveValue("nothing");
});

test("a skill's key is given in the skills pane, straight to the keychain, and only whether it is held comes back", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "knowledge" }).click();
  const field = page.getByLabel("the key for weather");
  await expect(field).toBeVisible();
  await expect(page.locator(".forged").getByRole("button", { name: "keep" })).toBeDisabled();
  await field.fill("sk-a-test-value");
  await field.press("Enter");
  expect((await calledWith(page, "store_secret")).map((one) => one.args)).toEqual([{ name: "skill:weather", secret: "sk-a-test-value" }]);
  const kept = page.locator(".forged .key strong");
  await expect(kept).toHaveText("weather");
  await expect(field).toHaveCount(0);
  expect(await page.locator(".forged").innerHTML()).not.toContain("sk-a-test-value");
  expect((await calledWith(page, "skill_keys_held")).at(-1)?.args).toEqual({ names: ["weather"] });

  await page.locator(".forged .key").getByRole("button", { name: "forget" }).click();
  expect((await calledWith(page, "forget_secret")).map((one) => one.args)).toEqual([{ name: "skill:weather" }]);
  await expect(field).toBeVisible();
  await expect(field).toHaveValue("");
});

test("a skill changed since it was approved shows what changed and why, and improving one asks the model to test and mend it", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "knowledge" }).click();
  const changed = page.locator(".forged li", { hasText: "tides_today" });
  await expect(changed.locator(".why")).toHaveText("changed since approved: the API moved to v2");
  await expect(changed.locator(".change del")).toHaveText("GET https://api.example.com/v1/tides");
  await expect(changed.locator(".change ins")).toHaveText("GET https://api.example.com/v2/tides");
  await expect(changed.getByRole("button", { name: "improve" })).toHaveCount(0);

  await page.locator(".forged li", { hasText: "weather_now" }).getByRole("button", { name: "improve" }).click();
  const [asked] = await calledWith(page, "ask");
  expect(String(asked?.args.prompt)).toMatch(/^Improve the skill weather_now\. Test it with skill_test/);
  await page.getByRole("button", { name: "stop" }).click();
});

test("an approved skill is a slash, its values offered as they are typed, and sent as typed with the turn", async ({ page }) => {
  const box = page.locator(".composer textarea");
  const menu = page.locator(".suggest li");
  await box.fill("/wea");
  await expect(menu).toHaveText([/\/weather_now/]);
  await box.press("Enter");
  await expect(box).toHaveValue("/weather_now ");
  await expect(menu.nth(0)).toContainText("Singapore");
  await expect(menu.nth(1)).toContainText("Oslo");
  await box.pressSequentially("Os");
  await expect(menu).toHaveCount(1);
  await box.press("Tab");
  await expect(box).toHaveValue("/weather_now Oslo ");
  await box.press("Enter");
  const [asked] = await calledWith(page, "ask");
  expect(asked?.args.prompt).toBe("/weather_now Oslo");
  expect(asked?.args.skill).toEqual({ name: "weather_now", values: { q: "Oslo" } });
  await page.getByRole("button", { name: "stop" }).click();

  await box.fill("/weather_now ");
  await box.press("Enter");
  await expect(page.getByText("q is needed")).toBeVisible();
  expect(await calledWith(page, "ask")).toHaveLength(1);
});

test("the Notion database the island's todos are kept in is chosen in settings", async ({ page }) => {
  await page.locator(".rail").getByRole("button", { name: "system" }).click();
  const kept = page.getByRole("combobox", { name: "todos are kept in" });
  await expect(kept).toHaveValue("");
  await expect(kept.locator("option")).toHaveText(["no database", "Tasks", "Reading"]);
  await kept.selectOption("Tasks");
  expect((await calledWith(page, "notion_todos_choose")).map((one) => one.args)).toEqual([{ id: "db1" }]);
  await expect(kept).toHaveValue("db1");
});
