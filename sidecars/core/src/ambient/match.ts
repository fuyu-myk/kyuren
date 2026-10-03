import type { Rule } from "#ambient/rules.ts";
import type { Item } from "#connect/source.ts";

export type Firing = {
  rule: string;
  voice: boolean;
  title: string;
  why: string;
  at: string;
  /// When the thing itself is, for an event or a due task, so what is shown later can say the
  /// time rather than how far off it was when the rule fired.
  when?: string;
  /// One thing fires once for one rule, however many times it is looked at.
  key: string;
};

const APART = String.fromCharCode(31);

export function keyOf(rule: Rule, item: Item): string {
  return [rule.id, item.source, item.title, item.at].join(APART);
}

function minutesUntil(item: Item, now: Date): number {
  return (Date.parse(item.at) - now.getTime()) / 60_000;
}

function reason(rule: Rule, item: Item, now: Date): string | undefined {
  switch (rule.when) {
    case "event": {
      if (item.kind !== "event" || !item.timed || item.done) return undefined;
      const minutes = minutesUntil(item, now);
      if (minutes < 0 || minutes > rule.within) return undefined;
      return `starts in ${Math.max(1, Math.round(minutes))} minutes`;
    }
    case "message": {
      if (item.kind !== "message") return undefined;
      if (rule.matching && !item.title.toLowerCase().includes(rule.matching.toLowerCase())) return undefined;
      return "arrived";
    }
    case "task": {
      if (item.kind !== "task" || item.done) return undefined;
      if (minutesUntil(item, now) >= 0) return undefined;
      return `was due ${item.at.slice(0, 10)}`;
    }
  }
}

/// Everything that should reach the user now and has not already. Messages only count from the
/// last look onwards, so a look that runs every few minutes does not keep finding the same inbox.
export function matching(
  rules: Rule[],
  items: Item[],
  now: Date,
  since: Date | undefined,
  seen: (key: string) => boolean,
): Firing[] {
  const firings: Firing[] = [];
  const found = new Set<string>();

  for (const rule of rules) {
    for (const item of items) {
      if (rule.when === "message" && since && Date.parse(item.at) <= since.getTime()) continue;
      const why = reason(rule, item, now);
      if (!why) continue;
      const key = keyOf(rule, item);
      if (seen(key) || found.has(key)) continue;
      found.add(key);
      firings.push({
        rule: rule.id,
        voice: rule.voice,
        title: item.title,
        why,
        at: now.toISOString(),
        when: item.at,
        key,
      });
    }
  }

  return firings;
}
