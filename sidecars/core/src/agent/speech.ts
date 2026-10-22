/// The shortest stretch worth a synthesis call of its own, as the voice judges a whole reply: a few
/// words at a time cost the synthesiser more in overhead than they save in waiting.
const SHORTEST = 24;
const ENDS = new Set([".", "!", "?", "\n"]);
/// Where a sentence pauses, once a space follows: a comma in a number or a colon in a time does not.
const PAUSES = new Set([",", ";", ":"]);

/// Markup the voice can strip only whole, which a sentence end inside would split: a fenced block,
/// or a link whose address has full stops in it.
function inMarkup(held: string): boolean {
  const unclosed = (fence: RegExp) => (held.match(fence) ?? []).length % 2 === 1;
  return unclosed(/```/g) || unclosed(/~~~/g) || /\]\([^)]*$/.test(held);
}

/// What a spoken turn says, a sentence at a time as the reply arrives, so speaking begins before
/// the reply is finished. A tool's own words, which a report of facts is, are said as soon as the
/// tool gives them, and the model's words after them are not: they retell what was just heard.
export class Speech {
  private held = "";
  private begun = false;
  private told = false;
  private over = false;
  private readonly say: (text: string) => void;
  private readonly end: () => void;

  constructor(say: (text: string) => void, end: () => void) {
    this.say = say;
    this.end = end;
  }

  /// The model's words as they stream.
  heard(chunk: string): void {
    if (this.told) return;
    for (const character of chunk) {
      // The opening is said at its first pause rather than its first full stop. A long first
      // sentence would otherwise be waited for whole, and synthesised whole, before any sound.
      const paused = !this.begun && /\s/.test(character) && PAUSES.has(this.held.at(-1) ?? "");
      if (paused && this.ready()) this.flush();
      this.held += character;
      if (ENDS.has(character) && this.ready()) this.flush();
    }
  }

  /// A tool's words, said as they are, after whatever the model had begun to say.
  spoken(text: string): void {
    this.flush();
    this.told = true;
    this.over = false;
    if (text.trim() !== "") this.say(text.trim());
  }

  /// The model has begun another step. After a tool has spoken, nothing the model goes on to say
  /// is said, so the voice is told the reply is over rather than kept waiting through the retelling.
  moved(): void {
    if (!this.told || this.over) return;
    this.over = true;
    this.end();
  }

  /// The reply is over, and what is held is said.
  done(): void {
    if (!this.told) this.flush();
  }

  private ready(): boolean {
    return this.held.trim().length >= SHORTEST && !inMarkup(this.held);
  }

  private flush(): void {
    const rest = this.held.trim();
    this.held = "";
    if (rest === "") return;
    this.begun = true;
    this.say(rest);
  }
}
