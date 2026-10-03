import { connected, graph } from "#connect/microsoft/api.ts";
import { sender } from "#connect/sender.ts";
import type { Item, Source, Span } from "#connect/source.ts";

const MOST = 8;

type Message = {
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
};

export const microsoftMail: Source = {
  name: "microsoft_mail",
  effect: "outbound",
  origin: "https://graph.microsoft.com/mail",
  available: connected,

  async read(span: Span): Promise<Item[]> {
    const path = `/me/mailFolders/inbox/messages?$filter=isRead eq false`
      + ` and receivedDateTime ge ${span.from}T00:00:00Z`
      + `&$top=${MOST}&$orderby=receivedDateTime desc`
      + `&$select=subject,receivedDateTime,from`;

    const answer = await graph(encodeURI(path));
    const messages = (answer.value ?? []) as Message[];

    return messages.map((message) => ({
      source: "microsoft_mail",
      kind: "message" as const,
      collection: "Inbox",
      title: message.subject ?? "no subject",
      at: message.receivedDateTime ?? new Date().toISOString(),
      timed: true,
      status: message.from?.emailAddress?.name
        ?? sender(message.from?.emailAddress?.address),
      done: false,
    }));
  },
};
