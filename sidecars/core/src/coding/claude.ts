import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import type { Coding, State } from "#coding/session.ts";

/// Whether the process that wrote a session's file is still that process.
export type Alive = (pid: number, procStart?: string) => Promise<boolean>;

const ENTRY = z.object({
  pid: z.number().int().positive(),
  sessionId: z.string().min(1),
  kind: z.string().optional(),
  cwd: z.string().min(1),
  procStart: z.string().optional(),
  entrypoint: z.string().optional(),
  name: z.string().optional(),
  status: z.string().optional(),
  waitingFor: z.string().optional(),
  startedAt: z.number().optional(),
  statusUpdatedAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

const VIA: Record<string, string> = {
  "claude-desktop": "the desktop app",
  "claude-vscode": "VS Code",
  cli: "a terminal",
};

/// The harness's own helpers, which keep the same kind of file but are no one's session.
const HELPERS = new Set(["daemon", "daemon-worker", "spare"]);

function stateOf(status: string | undefined): State {
  // A shell is a turn ended with a command still running behind it, which Claude Code itself
  // shows as working.
  if (status === "busy" || status === "shell") return "working";
  if (status === "waiting") return "waiting";
  return "idle";
}

/// Claude Code keeps one small file per running session, named for its process, saying what the
/// session is doing and what it waits for. The file is not documented, so anything that does not
/// read as one is passed over rather than guessed at.
export async function claudeSessions(dir: string, alive: Alive): Promise<Coding[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => /^\d+\.json$/.test(name));
  const found: Coding[] = [];
  for (const name of names) {
    const raw = await readFile(join(dir, name), "utf8").catch(() => undefined);
    if (raw === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const entry = ENTRY.safeParse(parsed);
    if (!entry.success) continue;
    const one = entry.data;
    if (one.kind && HELPERS.has(one.kind)) continue;
    const state = stateOf(one.status);
    const active = one.statusUpdatedAt ?? one.updatedAt ?? one.startedAt ?? 0;
    if (!(await alive(one.pid, one.procStart))) continue;
    const via = one.entrypoint ? VIA[one.entrypoint] : undefined;
    found.push({
      id: one.sessionId,
      harness: "claude",
      project: basename(one.cwd),
      ...(one.name ? { title: one.name } : {}),
      state,
      ...(state === "waiting" && one.waitingFor ? { waitingFor: one.waitingFor } : {}),
      ...(one.startedAt ? { started: one.startedAt } : {}),
      active,
      ...(via ? { via } : {}),
      pid: one.pid,
    });
  }
  return found;
}
