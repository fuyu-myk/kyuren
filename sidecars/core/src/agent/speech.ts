/// The shortest stretch worth a synthesis call of its own, as the voice judges a whole reply: a few
/// words at a time cost the synthesiser more in overhead than they save in waiting.
const SHORTEST = 24;
const ENDS = new Set([".", "!", "?", "\n"]);

/// What a spoken turn says, a sentence at a time as the reply arrives, so speaking begins before
/// the reply is finished. A tool's own words, which a report of facts is, are said as soon as the
/// tool gives them, and the model's words after them are not: they retell what was just heard.
export class Speech {
  private held = "";
  private told = false;
  private readonly say: (text: string) => void;

  constructor(say: (text: string) => void) {
    this.say = say;
  }

  /// The model's words as they stream.
  heard(chunk: string): void {
    if (this.told) return;
    for (const character of chunk) {
      this.held += character;
      if (ENDS.has(character) && this.held.trim().length >= SHORTEST) this.flush();
    }
  }

  /// A tool's words, said as they are, after whatever the model had begun to say.
  spoken(text: string): void {
    this.flush();
    this.told = true;
    if (text.trim() !== "") this.say(text.trim());
  }

  /// The reply is over, and what is held is said.
  done(): void {
    if (!this.told) this.flush();
  }

  private flush(): void {
    const rest = this.held.trim();
    this.held = "";
    if (rest !== "") this.say(rest);
  }
}
