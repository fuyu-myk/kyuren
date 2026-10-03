import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { access, chmod, copyFile, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Settings = Record<string, unknown>;

/// Whether a harness is here, whether Kyuren's hook is in its settings, and what went wrong if
/// putting it there or taking it out did not happen.
export type HookState = { present: boolean; on: boolean; trouble?: string };

/// The relay's name in Kyuren's own folder.
const RELAY = "kyuren-hook";
/// The relay waits a little longer than the island holds a question, so Kyuren always answers
/// first, and Claude Code's own limit on the hook is a little longer again.
const WAIT = 50;
const TIMEOUT = 60;
/// What Claude Code shows under its spinner while the question is on the island.
const SAYS = "Asking on Kyuren's island";

const UNREADABLE = "Claude Code's settings file could not be read, so it was left as it is.";

function isObject(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/// Quoted for the shell Claude Code runs a hook's command in, whatever the path holds.
export function quoted(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}

export function claudeCommand(relay: string, socket: string): string {
  return `${quoted(relay)} claude PermissionRequest --wait ${WAIT} --socket ${quoted(socket)}`;
}

/// Kyuren's own hook is the one that runs its relay from where it put it, and nothing else: a hook
/// of the user's that only mentions the relay is theirs.
function ours(hook: unknown, relay: string): boolean {
  return isObject(hook) && typeof hook.command === "string" && hook.command.startsWith(`${quoted(relay)} `);
}

/// The groups of hooks with Kyuren's own taken out, and any group left with none dropped.
function cleaned(groups: unknown[], relay: string): unknown[] {
  return groups.flatMap((group) => {
    if (!isObject(group) || !Array.isArray(group.hooks)) return [group];
    const kept = group.hooks.filter((hook) => !ours(hook, relay));
    if (kept.length === group.hooks.length) return [group];
    return kept.length > 0 ? [{ ...group, hooks: kept }] : [];
  });
}

export function hasClaudeHook(settings: Settings, relay: string): boolean {
  const hooks = settings.hooks;
  if (!isObject(hooks)) return false;
  return Object.values(hooks).some(
    (groups) =>
      Array.isArray(groups) && groups.some((group) => isObject(group) && Array.isArray(group.hooks) && group.hooks.some((hook) => ours(hook, relay))),
  );
}

/// The settings with Kyuren's permission hook in them, once, after the user's own.
export function withClaudeHook(settings: Settings, relay: string, socket: string): Settings {
  const hook = { hooks: [{ type: "command", command: claudeCommand(relay, socket), timeout: TIMEOUT, statusMessage: SAYS }] };
  const hooks = isObject(settings.hooks) ? settings.hooks : {};
  const groups = Array.isArray(hooks.PermissionRequest) ? cleaned(hooks.PermissionRequest, relay) : [];
  return { ...settings, hooks: { ...hooks, PermissionRequest: [...groups, hook] } };
}

/// The settings as they were before Kyuren's hook went in: an event or a hooks section that only
/// held Kyuren's goes with it.
export function withoutClaudeHook(settings: Settings, relay: string): Settings {
  const hooks = settings.hooks;
  if (!isObject(hooks)) return settings;
  const kept: Settings = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      kept[event] = groups;
      continue;
    }
    const left = cleaned(groups, relay);
    if (left.length > 0 || groups.length === 0) kept[event] = left;
  }
  if (Object.keys(kept).length === 0 && Object.keys(hooks).length > 0) {
    const { hooks: _gone, ...rest } = settings;
    return rest;
  }
  return { ...settings, hooks: kept };
}

function indentOf(text: string): string {
  return /\n([ \t]+)\S/.exec(text)?.[1] ?? "  ";
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/// A copy of the file as it stood, kept beside Kyuren's own files before anything is written.
async function keep(text: string, kyurenHome: string): Promise<void> {
  const folder = join(kyurenHome, "backups");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(join(folder, `claude-settings-${stamp}.json`), text, { mode: 0o600 });
}

/// Changes Claude Code's settings file the way its owner would by hand: read whole, changed, its
/// own indentation, ending and permissions kept, a copy of it kept first, and written whole beside
/// it and moved over it. A file that is a link is changed where it lives, the link left a link. A
/// file that does not read as JSON, or that changes meanwhile, is left be.
async function edited(link: string, kyurenHome: string, change: (settings: Settings) => Settings): Promise<void> {
  const file = await realpath(link).catch(() => link);
  const text = await readFile(file, "utf8").catch((failure: NodeJS.ErrnoException) => {
    if (failure.code === "ENOENT") return undefined;
    throw failure;
  });
  let before: unknown = {};
  if (text !== undefined) {
    try {
      before = JSON.parse(text);
    } catch {
      throw new Error(UNREADABLE);
    }
  }
  if (!isObject(before)) throw new Error(UNREADABLE);
  const after = change(before);
  if (JSON.stringify(after) === JSON.stringify(before)) return;
  if (text !== undefined) await keep(text, kyurenHome);
  const mode = text === undefined ? 0o600 : (await stat(file)).mode & 0o777;
  const ending = text === undefined || text.endsWith("\n") ? "\n" : "";
  const out = `${JSON.stringify(after, null, indentOf(text ?? ""))}${ending}`;
  const beside = `${file}.kyuren-${randomUUID()}`;
  await writeFile(beside, out, { mode });
  await chmod(beside, mode);
  // Looked at again only once the new file is ready, so nothing can change between the look and
  // the move but the move itself.
  const again = await readFile(file, "utf8").catch(() => undefined);
  if (again !== text) {
    await unlink(beside).catch(() => {});
    throw new Error("Claude Code's settings changed while being edited, so nothing was written. Try again.");
  }
  await rename(beside, file);
}

/// The relay copied to a place of Kyuren's own, so the hook keeps working however the source moves
/// or is rebuilt.
async function placeRelay(built: string, kyurenHome: string): Promise<string> {
  try {
    await access(built, constants.X_OK);
  } catch {
    throw new Error("The hook relay is not built yet: run pnpm sidecars.");
  }
  const folder = join(kyurenHome, "bin");
  await mkdir(folder, { recursive: true });
  const placed = join(folder, RELAY);
  const beside = `${placed}.${randomUUID()}`;
  await copyFile(built, beside);
  await chmod(beside, 0o755);
  await rename(beside, placed);
  return placed;
}

/// Where Kyuren listens for hooks, in a folder of its own.
export function hookSocket(kyurenHome: string): string {
  return join(kyurenHome, "hooks", "kyuren.sock");
}

function placedRelay(kyurenHome: string): string {
  return join(kyurenHome, "bin", RELAY);
}

export async function claudeHookState(options: { claudeHome: string; kyurenHome: string }): Promise<HookState> {
  if (!(await exists(options.claudeHome))) return { present: false, on: false };
  const text = await readFile(join(options.claudeHome, "settings.json"), "utf8").catch(() => undefined);
  if (text === undefined) return { present: true, on: false };
  try {
    const parsed: unknown = JSON.parse(text);
    return { present: true, on: isObject(parsed) && hasClaudeHook(parsed, placedRelay(options.kyurenHome)) };
  } catch {
    return { present: true, on: false, trouble: UNREADABLE };
  }
}

/// Each change waits for the one before it, so two made together cannot each undo the other.
let changing: Promise<unknown> = Promise.resolve();

/// Puts Kyuren's permission hook into Claude Code's own settings, or takes it out.
export function setClaudeHook(options: { claudeHome: string; kyurenHome: string; relay: string; on: boolean }): Promise<HookState> {
  const made = changing.then(() => changeClaudeHook(options));
  changing = made.catch(() => undefined);
  return made;
}

async function changeClaudeHook(options: { claudeHome: string; kyurenHome: string; relay: string; on: boolean }): Promise<HookState> {
  const { claudeHome, kyurenHome, relay, on } = options;
  if (!(await exists(claudeHome))) return { present: false, on: false, ...(on ? { trouble: "Claude Code is not installed for this user." } : {}) };
  const file = join(claudeHome, "settings.json");
  try {
    if (on) {
      const placed = await placeRelay(relay, kyurenHome);
      await edited(file, kyurenHome, (settings) => withClaudeHook(settings, placed, hookSocket(kyurenHome)));
    } else {
      await edited(file, kyurenHome, (settings) => withoutClaudeHook(settings, placedRelay(kyurenHome)));
    }
    return { present: true, on };
  } catch (failure) {
    const state = await claudeHookState({ claudeHome, kyurenHome });
    return { ...state, trouble: failure instanceof Error ? failure.message : String(failure) };
  }
}
