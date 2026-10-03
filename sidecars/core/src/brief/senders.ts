import type { Item } from "#connect/source.ts";

export type FromSender = {
  sender: string;
  subjects: string[];
  count: number;
};

const UNKNOWN = "someone";

/// Mail gathered by whoever sent it. An inbox repeats itself: the same service writes twice, and a
/// brief that reads both out sounds like it is stuck. The same subject from the same sender is one
/// thing said twice, so it is said once and counted.
export function bySender(messages: Item[]): FromSender[] {
  const order: string[] = [];
  const grouped = new Map<string, { subjects: string[]; count: number }>();

  for (const message of messages) {
    const sender = message.status?.trim() || UNKNOWN;
    let group = grouped.get(sender);
    if (!group) {
      group = { subjects: [], count: 0 };
      grouped.set(sender, group);
      order.push(sender);
    }
    group.count += 1;
    if (!group.subjects.includes(message.title)) {
      group.subjects.push(message.title);
    }
  }

  return order.map((sender) => ({ sender, ...grouped.get(sender)! }));
}

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

export function inWords(count: number): string {
  return WORDS[count] ?? `${count}`;
}
