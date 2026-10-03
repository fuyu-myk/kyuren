import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_ENGINE, FALLBACK_ENGINE } from "#connect/web/search.ts";

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");

/// The settings file the host writes. Only what this process needs is read out of it; the rest
/// belongs to the host and is left alone.
const Settings = z.object({
  web: z.object({ engine: z.string().min(1).optional(), fallback: z.string().min(1).optional() }).optional(),
});

function settings(): z.infer<typeof Settings> {
  try {
    return Settings.parse(JSON.parse(readFileSync(join(root, "settings.json"), "utf8")));
  } catch {
    return {};
  }
}

/// Where a search goes. Read each time, so a change in the window takes effect on the next search.
export function webEngine(): string {
  return settings().web?.engine ?? DEFAULT_ENGINE;
}

/// Where a search goes when the first engine refuses it or finds nothing.
export function webFallback(): string {
  return settings().web?.fallback ?? FALLBACK_ENGINE;
}
