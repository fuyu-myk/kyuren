import { randomUUID } from "node:crypto";
import type { Transport } from "#transport.ts";

export type Kind = "page" | "search";

export type Found = { title: string; url: string; snippet: string };

export type Read = {
  ok: boolean;
  /// Where the page ended up, after whatever it redirected through.
  url?: string;
  title?: string;
  text?: string;
  results?: Found[];
  reason?: string;
};

export type Reader = {
  /// `from` is the page of a PDF to start reading at; a web page has no pages and ignores it.
  read: (url: string, kind: Kind, from?: number) => Promise<Read>;
  answer: (id: string, read: Read) => boolean;
  pending: () => number;
};

/// How long a page is given before the request is answered as a failure rather than left open.
const PATIENCE = 45_000;

/// Asks whoever is driving the sidecar to read a page in its own browser, and waits for what came
/// back. The sidecar has no browser; the host does, hidden, and hands back what a script found on
/// the page: its text, or the results if the page was a search.
export function createReader(transport: Transport): Reader {
  const waiting = new Map<string, (read: Read) => void>();

  return {
    read: (url, kind, from) =>
      new Promise<Read>((resolve) => {
        const id = randomUUID();
        const timer = setTimeout(() => {
          if (waiting.delete(id)) resolve({ ok: false, reason: `no answer for ${url} within ${PATIENCE / 1000} s` });
        }, PATIENCE);
        waiting.set(id, (read) => {
          clearTimeout(timer);
          resolve(read);
        });
        transport.send({ event: "web.read.request", data: { id, url, kind, ...(from ? { from } : {}) } });
      }),

    answer: (id, read) => {
      const resolve = waiting.get(id);
      if (!resolve) return false;
      waiting.delete(id);
      resolve(read);
      return true;
    },

    pending: () => waiting.size,
  };
}

let held: Reader | undefined;

export function sharedReader(transport: Transport): Reader {
  held ??= createReader(transport);
  return held;
}

/// For the parts of the process that only have the reader once the transport exists.
export function readerIfAny(): Reader | undefined {
  return held;
}
