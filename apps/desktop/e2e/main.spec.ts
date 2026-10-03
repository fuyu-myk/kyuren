import { expect, test, type Page } from "@playwright/test";

type Called = { cmd: string; args: Record<string, unknown> };

/// The main window has no preview harness, so Tauri's own channel is stood in for the way its
/// mocks stand in for it: an event goes to whoever listens, and every command called is kept.
function standIn(): void {
  const callbacks = new Map<number, (data: unknown) => void>();
  const listening = new Map<string, number[]>();
  const called: Called[] = [];
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
        throw new Error(`${cmd} has no answer here`);
      },
    },
    standIn: {
      listens: (event: string) => (listening.get(event) ?? []).length,
      emit: (event: string, payload: unknown) => {
        for (const id of listening.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
      },
      called: (cmd: string) => called.filter((one) => one.cmd === cmd),
    },
  });
}

type StandIn = {
  listens: (event: string) => number;
  emit: (event: string, payload: unknown) => void;
  called: (cmd: string) => Called[];
};

async function emit(page: Page, name: string, payload: unknown): Promise<void> {
  await page.evaluate(([event, data]) => (window as unknown as { standIn: StandIn }).standIn.emit(event, data), [name, payload] as const);
}

async function answers(page: Page): Promise<Called[]> {
  return page.evaluate(() => (window as unknown as { standIn: StandIn }).standIn.called("resolve_permission"));
}

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
