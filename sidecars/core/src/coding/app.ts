import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

/// Where the Claude app keeps a record of each of its sessions, under folders for the account and
/// the organisation. Not documented, so a record that does not read as one is passed over.
export function appRecords(home: string = homedir()): string {
  return join(home, "Library", "Application Support", "Claude", "claude-code-sessions");
}

const RECORD = z.object({
  sessionId: z.string().regex(/^local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  cliSessionId: z.string().min(1).max(200),
  isArchived: z.boolean().optional(),
});

async function within(dir: string): Promise<string[]> {
  return (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => join(dir, entry.name));
}

/// The link that opens a Claude Code session in the Claude app itself, as the app gives it, found
/// from the app's own record of the session. Nothing for one it has no record of, or has archived.
export async function appLink(dir: string, session: string): Promise<string | undefined> {
  for (const account of await within(dir)) {
    for (const place of await within(account)) {
      const names = (await readdir(place).catch(() => [] as string[])).filter((name) => name.startsWith("local_") && name.endsWith(".json"));
      for (const name of names) {
        const text = await readFile(join(place, name), "utf8").catch(() => undefined);
        if (text === undefined) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          continue;
        }
        const record = RECORD.safeParse(parsed);
        if (record.success && record.data.cliSessionId === session && !record.data.isArchived) return `claude://claude.ai/epitaxy/${record.data.sessionId}`;
      }
    }
  }
  return undefined;
}
