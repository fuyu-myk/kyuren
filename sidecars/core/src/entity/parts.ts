import { key } from "#entity/names.ts";

const INITIAL = /^[a-z]\.?$/;

/// The words of these forms that could stand for the name on their own: "petra" and "holst" for
/// Petra Holst. Initials and anything under three letters stand for nothing.
export function partsOf(aliases: string[]): string[] {
  const parts = new Set<string>();
  for (const alias of aliases) {
    for (const word of key(alias).split(" ")) {
      if (word.length >= 3 && !INITIAL.test(word)) parts.add(word);
    }
  }
  return [...parts].sort();
}

/// Every word the text writes in lowercase. A word the notes write that way is an ordinary word,
/// whatever name it also happens to be part of: "night" is not Night Market.
export function ordinaryIn(text: string): string[] {
  return [...text.matchAll(/(?<![\p{L}\p{N}])\p{Ll}[\p{Ll}']*(?![\p{L}\p{N}])/gu)].map((one) => one[0].replace(/'s$/, ""));
}
