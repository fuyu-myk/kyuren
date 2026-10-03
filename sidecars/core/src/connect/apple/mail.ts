import { access, apple } from "#connect/apple/helper.ts";
import { sender } from "#connect/sender.ts";
import type { Item, Source, Span } from "#connect/source.ts";

const MOST = 12;

type Message = {
  subject: string;
  from: string;
  at: string;
};

/// Unread mail from the client the Mac already has. Mail is asked only when it is already running,
/// so a brief never opens it.
export const appleMail: Source = {
  name: "apple_mail",
  effect: "personal",
  origin: "applescript://mail",
  /// Mail not being open is an ordinary state, not a fault. Reporting it as one would put the same
  /// complaint in every brief for anyone who does not keep a mail client running.
  available: async () => (await access())?.mail === "running",

  async read(span: Span): Promise<Item[]> {
    void span;
    const messages = await apple<Message[]>(["mail", "--limit", `${MOST}`]);

    return messages.map((message) => ({
      source: "apple_mail",
      kind: "message" as const,
      collection: "Inbox",
      title: message.subject,
      at: message.at,
      timed: true,
      status: sender(message.from),
      done: false,
    }));
  },
};
