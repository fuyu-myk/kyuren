import { connected, google } from "#connect/google/api.ts";
import { sender } from "#connect/sender.ts";
import type { Item, Source, Span } from "#connect/source.ts";

const MESSAGES = "https://gmail.googleapis.com/gmail/v1/users/me/messages";

/// A brief is read aloud, so the inbox is sampled rather than recited. Anything beyond a handful
/// stops being a summary.
const MOST = 8;

/// Gmail already separates what a person writes from what a mailing list sends. Without this the
/// brief reads out a list of newsletters and calls it the morning's mail.
const PRIMARY = "category:primary";

type Listed = { id?: string };

type Detail = {
  internalDate?: string;
  payload?: { headers?: Array<{ name?: string; value?: string }> };
};

function header(detail: Detail, wanted: string): string | undefined {
  return detail.payload?.headers?.find(
    (one) => (one.name ?? "").toLowerCase() === wanted,
  )?.value;
}

export const gmail: Source = {
  name: "gmail",
  effect: "outbound",
  origin: "https://gmail.googleapis.com",
  available: connected,

  async read(span: Span): Promise<Item[]> {
    const url = new URL(MESSAGES);
    url.searchParams.set(
      "q",
      `is:unread in:inbox ${PRIMARY} after:${span.from.replace(/-/g, "/")}`,
    );
    url.searchParams.set("maxResults", `${MOST}`);

    const listed = await google(url.toString());
    const ids = ((listed.messages ?? []) as Listed[]).flatMap((one) => (one.id ? [one.id] : []));

    const details = await Promise.all(ids.map(async (id) => {
      const one = new URL(`${MESSAGES}/${id}`);
      one.searchParams.set("format", "metadata");
      for (const wanted of ["From", "Subject", "Date"]) {
        one.searchParams.append("metadataHeaders", wanted);
      }
      return (await google(one.toString())) as Detail;
    }));

    return details.map((detail) => ({
      source: "gmail",
      kind: "message" as const,
      collection: "Inbox",
      title: header(detail, "subject") ?? "no subject",
      at: new Date(Number(detail.internalDate ?? Date.now())).toISOString(),
      timed: true,
      status: sender(header(detail, "from")),
      done: false,
    }));
  },
};
