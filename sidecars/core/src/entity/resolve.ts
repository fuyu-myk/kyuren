import { contained, initialled } from "#entity/alike.ts";
import { key, tidy } from "#entity/names.ts";
import { partsOf } from "#entity/parts.ts";

export type Seen = {
  name: string;
  file: string;
  hash: string;
  proven: boolean;
  /// Whether it was written by itself, rather than being the tail of a run that opened a sentence.
  whole: boolean;
};

export type Entity = {
  /// The fullest form written, which is what a person would recognise.
  name: string;
  /// Every way it was written.
  aliases: string[];
  /// Words that may stand for it on their own in a question, such as a first name or a surname.
  parts: string[];
  files: string[];
  /// Every chunk that mentions it, by hash.
  chunks: string[];
  mentions: number;
  /// Whether any way of writing it was ever capitalised for a reason other than position.
  proven: boolean;
};

/// Drops a run that is a form with a word stuck on the front. A sentence opening "Ask Sam" reads
/// as one capitalised run, worth keeping as a mention but not worth listing as a way the name is
/// written. A run is kept when it was ever proven, since "Petra Holst" mid sentence beside "Holst"
/// is a whole name, and when its first word is a form in its own right, since "Ana Lindqvist"
/// beside "Ana" is too.
function withoutOvergrown(names: string[], proven: Set<string>): string[] {
  const forms = new Set(names.map(key));
  return names.filter((name) => {
    if (proven.has(key(name)) || forms.has(key(name).split(" ")[0] ?? "")) return true;
    return !names.some((other) => other !== name && name.endsWith(` ${other}`));
  });
}

/// Drops the tail of a run that was itself kept as a name. "Lindqvist" out of "Ana Lindqvist" was
/// never written alone, and the run it came from is the name; "Petra Holst" out of "Met Petra
/// Holst" is the name, because the run it came from was not.
function withoutTails(names: string[], whole: Set<string>): string[] {
  return names.filter(
    (name) => whole.has(key(name)) || !names.some((run) => run !== name && run.endsWith(` ${name}`)),
  );
}

function counted(names: string[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const name of names) count.set(name, (count.get(name) ?? 0) + 1);
  return count;
}

/// The fullest way the name was written, and among equally full ways the one written most often.
function fullest(aliases: string[], written: string[]): string {
  const count = counted(written);
  return [...aliases].sort(
    (a, b) =>
      b.split(" ").length - a.split(" ").length
      || b.length - a.length
      || (count.get(b) ?? 0) - (count.get(a) ?? 0),
  )[0] ?? "";
}

/// Groups by exactly the same name first, since most mentions are written the same way, and only
/// then asks whether two groups are the same thing.
export function group(seen: Seen[]): Map<string, Seen[]> {
  const groups = new Map<string, Seen[]>();
  for (const one of seen) {
    const at = key(one.name);
    groups.set(at, [...(groups.get(at) ?? []), one]);
  }
  return groups;
}

/// A name only counts once it has been written capitalised somewhere other than a sentence start,
/// or been titled, linked or coded. Otherwise every sentence's first word becomes a person.
///
/// Judged after merging rather than before, so a form that only ever opens a sentence still counts
/// when it belongs to a name proven elsewhere.
export function onlyProven(entities: Entity[]): Entity[] {
  return entities.filter((one) => one.proven);
}

/// Forms are joined by how they are written and by nothing else. Asking a model what two names
/// read like was measured and put Petra Nash nearer Petra Holst than her own initials, and one
/// course code nearer another than itself; spelling is the better witness.
export function merge(groups: Map<string, Seen[]>): Entity[] {
  const keys = [...groups.keys()];
  const joined = new Map<string, string>(keys.map((one) => [one, one]));

  const find = (at: string): string => {
    let root = at;
    while (joined.get(root) !== root) root = joined.get(root) ?? root;
    return root;
  };

  // Holders are looked up by word rather than by trying every pair: a vault of a few thousand
  // names is millions of pairs, and nearly all of them share no word at all.
  const byWord = new Map<string, string[]>();
  const byLast = new Map<string, string[]>();
  for (const one of keys) {
    const words = one.split(" ");
    for (const word of new Set(words)) {
      const held = byWord.get(word);
      if (held) held.push(one);
      else byWord.set(word, [one]);
    }
    const last = words[words.length - 1] ?? "";
    const held = byLast.get(last);
    if (held) held.push(one);
    else byLast.set(last, [one]);
  }
  const holdersOf = (short: string): string[] => {
    const words = short.split(" ");
    const fewest = words
      .map((word) => byWord.get(word) ?? [])
      .sort((a, b) => a.length - b.length)[0] ?? [];
    const lasts = byLast.get(words[words.length - 1] ?? "") ?? [];
    return [...new Set([...fewest, ...lasts])].filter(
      (long) => long !== short && (contained(short, long) || initialled(short, long)),
    );
  };

  // A form joins the one longer form it is written inside of, or stands for by initials. Held by
  // two it joins neither: "Sam" between Sam Lee and Sam Altman says nothing about which. Longer
  // forms go first, so that by the time "Petra" is placed, "Petra Holst" and the run "Met Petra
  // Holst" already count as one holder rather than two.
  const longestFirst = [...keys].sort(
    (a, b) => b.split(" ").length - a.split(" ").length || b.length - a.length,
  );
  for (const short of longestFirst) {
    const holders = new Set(holdersOf(short).map(find));
    if (holders.size === 1) joined.set(find(short), [...holders][0]!);
  }

  const gathered = new Map<string, Seen[]>();
  for (const at of keys) {
    const root = find(at);
    gathered.set(root, [...(gathered.get(root) ?? []), ...(groups.get(at) ?? [])]);
  }

  return [...gathered.values()]
    .map((mentions) => {
      const written = mentions.map((one) => tidy(one.name));
      const proven = new Set(mentions.filter((one) => one.proven).map((one) => key(one.name)));
      const whole = new Set(mentions.filter((one) => one.whole).map((one) => key(one.name)));
      const aliases = withoutTails(withoutOvergrown([...new Set(written)], proven), whole).sort();
      return {
        name: fullest(aliases, written),
        aliases,
        parts: partsOf(aliases),
        files: [...new Set(mentions.map((one) => one.file))].sort(),
        chunks: [...new Set(mentions.map((one) => one.hash))].sort(),
        mentions: mentions.length,
        proven: mentions.some((one) => one.proven),
      };
    })
    .sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name));
}
