const INITIAL = /^[a-z]\.?$/;

function words(key: string): string[] {
  return key.split(" ");
}

/// Whether the shorter form is written wholly inside the longer: "Ana" in "Ana Lindqvist", "Holst"
/// in "Petra Holst". Two letters is too little to mean anything.
export function contained(short: string, long: string): boolean {
  if (short.length < 3 || short.length >= long.length) return false;
  const inside = new Set(words(long));
  return words(short).every((word) => inside.has(word));
}

/// Whether the shorter form is the longer with some words cut to their initials: "P. Holst" for
/// "Petra Holst". The last word must be written out in both, since an initial alone stands for
/// nothing in particular.
export function initialled(short: string, long: string): boolean {
  const cut = words(short);
  const full = words(long);
  if (cut.length !== full.length || cut.length < 2 || short === long) return false;
  if (cut[cut.length - 1] !== full[full.length - 1]) return false;

  let shortened = 0;
  for (let at = 0; at < cut.length - 1; at += 1) {
    const one = cut[at]!;
    const two = full[at]!;
    if (one === two) continue;
    if (!INITIAL.test(one) || one[0] !== two[0]) return false;
    shortened += 1;
  }
  return shortened > 0;
}
