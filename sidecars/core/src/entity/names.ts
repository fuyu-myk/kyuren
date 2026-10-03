export type Candidate = {
  name: string;
  /// Whether it was capitalised somewhere other than the start of a sentence. A word is capital at
  /// the start of a sentence whether it is a name or not, so that position proves nothing on its
  /// own: "Petra is my partner" and "Ask the registrar" look the same.
  proven: boolean;
  /// Whether it was written by itself, rather than being the tail of a run that opened a sentence.
  whole: boolean;
};

/// Spaces and tabs between the words, never a line break. Allowing any whitespace ran a heading
/// into the first word of the sentence under it, so "Monday" and "Met Petra Holst" became one
/// candidate and the name itself was never seen.
const TITLED = /\b(?:Professor|Prof\.?|Dr\.?|Doctor|Mr\.?|Mrs\.?|Ms\.?)[ \t]+([A-Z][\w'-]*(?:[ \t]+[A-Z][\w'-]*){0,2})/g;
const LINKED = /\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g;
/// A course or module code: letters then digits, as they are actually written down.
const CODED = /\b([A-Z]{2,5}\s?\d{2,4}[A-Z]?)\b/g;
const CAPITALISED = /\b([A-Z][a-z]{1,}(?:[ \t]+[A-Z][a-z]{1,}){0,2})\b/g;

/// Words that are never names however they are capitalised: what begins sentences and clauses,
/// and the words notes are built out of, which a heading or a numbered label capitalises for
/// its own reasons.
const OPENERS = new Set([
  "the", "this", "that", "these", "those", "a", "an", "and", "but", "if", "when", "what", "where",
  "who", "whom", "whose", "which", "why", "how", "it", "its", "my", "our", "your", "their", "his",
  "her", "we", "they", "he", "she", "you", "me", "him", "them", "us", "i", "there", "here",
  "in", "on", "at", "by", "to", "of", "for", "from", "with", "without", "within", "into", "onto",
  "over", "under", "about", "after", "before", "between", "through", "during", "until", "since",
  "as", "or", "nor", "so", "yet", "because", "although", "though", "unless", "while", "whereas",
  "whether", "than", "then", "also", "only", "just", "not", "no", "yes", "some", "any", "all",
  "each", "every", "both", "either", "neither", "none", "more", "most", "much", "many", "few",
  "several", "such", "very", "same", "other", "another", "one", "two", "three", "first", "second",
  "third", "last", "next", "new", "now", "still", "again", "even", "ever", "never", "always",
  "often", "sometimes", "however", "therefore", "thus", "hence", "otherwise", "instead",
  "something", "anything", "everything", "nothing", "someone", "anyone", "everyone", "nobody",
  "ask", "read", "write", "call", "check", "remember", "see", "use", "let", "make", "get",
  "note", "notes", "todo", "done", "summary", "overview", "introduction", "conclusion",
  "references", "source", "sources", "links", "tags", "tasks", "ideas", "questions", "answer",
  "example", "examples", "definition", "theorem", "lemma", "proof", "exercise", "problem",
  "solution", "figure", "table", "equation", "chapter", "section", "part", "step", "lecture",
  "week", "day", "today", "tomorrow", "yesterday", "morning", "afternoon", "evening", "night",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january",
  "february", "march", "april", "may", "june", "july", "august", "september", "october",
  "november", "december",
]);

/// Markdown that stands in front of a word without ending what came before it: a list mark, a
/// quote mark, a heading mark, emphasis, a bracket, a number in a list.
const MARK = /(?:[*_~"'(\[{>#`]+|[-+]|\d+[.)])$/;

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july", "august", "september",
  "october", "november", "december",
];

/// Capitalised for what they are, never for being names. A day gets its capital mid sentence too,
/// so position proves nothing about it, and it rides along at the end of a run: "Dr Delgado
/// Tuesdays" is not who the office hours belong to.
const NEVER = new Set([...DAYS, ...MONTHS].flatMap((word) => [word, `${word}s`]));

/// The run with any day or month cut off either end.
function trimmed(name: string): string {
  const words = tidy(name).split(" ");
  let from = 0;
  let to = words.length;
  while (from < to && NEVER.has(words[from]!.toLowerCase())) from += 1;
  while (to > from && NEVER.has(words[to - 1]!.toLowerCase())) to -= 1;
  return words.slice(from, to).join(" ");
}

export function tidy(name: string): string {
  return name.replace(/\s+/g, " ").replace(/[\s.,;:]+$/, "").trim();
}

/// Accents folded away, so a name typed with one on Monday and without on Tuesday is one name.
function plain(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function key(name: string): string {
  return plain(tidy(name))
    .toLowerCase()
    .replace(/^(?:professor|prof|dr|doctor|mr|mrs|ms)\.?\s+/, "")
    .replace(/['\u2019]s\b/g, "");
}

/// Whether this position begins a sentence: a line, a cell of a table, or what follows a full
/// stop, with any markdown in between peeled away. Stripping all trailing whitespace first made
/// the newline test unreachable, so every word at the start of a line counted as proven and
/// "Emailed" became a person; a list dash in front of "In" did the same for "In".
function starts(text: string, at: number): boolean {
  let before = text.slice(0, at);
  for (;;) {
    before = before.replace(/[ \t]+$/, "");
    if (before === "" || /[.!?:\n|]$/.test(before)) return true;
    const peeled = before.replace(MARK, "");
    if (peeled === before) return false;
    before = peeled;
  }
}

/// Whether nothing but punctuation follows the run on its line. Such a run is a title, and every
/// word of a title is capitalised for the title, so it has no tail worth proving.
function endsItsLine(text: string, from: number): boolean {
  const cut = text.indexOf("\n", from);
  return /^[\s:.,;\-\u2013*_~|)\]]*$/.test(text.slice(from, cut === -1 ? undefined : cut));
}

/// What in this text could be a name. Deciding whether it is happens across the whole vault, where
/// a word capitalised mid-sentence somewhere proves itself.
export function candidates(text: string): Candidate[] {
  const found = new Map<string, { proven: boolean; whole: boolean }>();

  const add = (name: string, proven: boolean, whole = true) => {
    const tidied = trimmed(name);
    if (tidied.length < 2) return;
    const had = found.get(tidied);
    found.set(tidied, { proven: (had?.proven ?? false) || proven, whole: (had?.whole ?? false) || whole });
  };

  for (const match of text.matchAll(LINKED)) add(match[1] ?? "", true);
  for (const match of text.matchAll(TITLED)) add(match[1] ?? "", true);
  for (const match of text.matchAll(CODED)) add(match[1] ?? "", true);

  for (const match of text.matchAll(CAPITALISED)) {
    const name = match[1] ?? "";
    const from = match.index ?? 0;
    if (OPENERS.has(name.toLowerCase())) continue;
    // A word in front of a number is a label: "Lecture 12", "Block 4", "Week 7".
    if (!name.includes(" ") && /^[ \t]*\d/.test(text.slice(from + name.length))) continue;

    const opening = starts(text, from);
    add(name, !opening);

    // A sentence beginning "Met Petra Holst" reads as one capitalised run, and only its first word
    // is explained by the position. What follows is capitalised for its own reasons, unless the
    // run is the whole of a line, which is a title rather than a sentence.
    if (opening && !endsItsLine(text, from + name.length)) {
      const rest = name.split(/[ \t]+/).slice(1).join(" ");
      if (rest !== "") add(rest, true, false);
    }
  }

  return [...found].map(([name, { proven, whole }]) => ({ name, proven, whole }));
}
