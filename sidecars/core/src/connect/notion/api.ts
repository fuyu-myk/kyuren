import { secretFor } from "#connect/secrets.ts";

const BASE = process.env.KYUREN_NOTION_URL ?? "https://api.notion.com";

/// Pinned. Notion changes shapes between versions, and this one is what the parsing here expects:
/// databases are addressed as data sources.
const VERSION = "2025-09-03";

const TIMEOUT = 20_000;

export function tokenHeld(): boolean {
  return secretFor("notion") !== undefined;
}

export async function notion(
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = secretFor("notion");
  if (!token) throw new Error("notion is not connected");

  const response = await fetch(`${BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "notion-version": VERSION,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });

  const text = await response.text();
  if (!response.ok) {
    // Notion explains itself in the body. The status alone does not distinguish a revoked token
    // from a page that was never shared, and the difference is what the user needs told.
    let said = text.slice(0, 200);
    try {
      said = (JSON.parse(text) as { message?: string }).message ?? said;
    } catch {
      // The body was not JSON, so the truncated text is the best account available.
    }
    throw new Error(`notion ${response.status}: ${said}`);
  }

  return JSON.parse(text) as Record<string, unknown>;
}
