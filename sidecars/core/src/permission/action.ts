import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

export const EFFECTS = [
  "read",
  "personal",
  "write",
  "execute",
  "outbound",
  "credential",
  "financial",
  "destroy",
] as const;

export type Effect = (typeof EFFECTS)[number];

export type Action = {
  tool: string;
  effect: Effect;
  /// What is being acted on: a path, a URL, a recipient. Never a summary.
  target: string;
  /// For a path whose links lead elsewhere, the path as it was written. Judged as well as the
  /// target, since either can be what makes a read a secret's.
  through?: string;
  /// What goes with it when that is not in its target: a search's words, a skill's values, a
  /// note's text. Shown with a question, since it is what a yes lets go.
  carrying?: string;
};

export type Verdict = "allow" | "ask" | "deny";

/// A place is a folder on disk or a collection somewhere else, written with a scheme. Both answer
/// the same question, which is where a write would land and what may be done there.
function remote(place: string): boolean {
  return place.includes("://");
}

/// How many links are followed before a path is taken to go nowhere, as one that leads to itself does.
const HOPS = 16;

/// Where a path would land on the disk: the deepest part of it that is there, a link to something
/// not there yet included, followed through its links, with the rest after it.
function land(path: string, hops: number): string {
  let existing = plain(path);
  const after: string[] = [];
  while (existing !== dirname(existing) && lstatSync(existing, { throwIfNoEntry: false }) === undefined) {
    after.unshift(basename(existing));
    existing = dirname(existing);
  }
  let real = existing;
  try {
    real = realpathSync.native(existing);
  } catch {
    // A link to something not there yet: a write through it creates what it points at.
    if (hops < HOPS && lstatSync(existing, { throwIfNoEntry: false })?.isSymbolicLink()) {
      real = land(resolve(dirname(existing), readlinkSync(existing)), hops + 1);
    }
  }
  return join(plain(real), ...after);
}

/// Where a path would land on the disk, as the disk compares it: the Data volume's name for the
/// root's folders taken off, accents composed one way, followed through its links, and without
/// case. Anything judged by where it is, is judged by this.
function landing(path: string): string {
  return land(path, 0).toLowerCase();
}

function within(target: string, root: string): boolean {
  // Resolving a remote address as a path would mangle it into something under the process's
  // working directory, and every comparison after that would be about the wrong thing.
  const [path, base] = remote(root)
    ? [target.trim().toLowerCase().replace(/\/+$/, ""), root.trim().toLowerCase().replace(/\/+$/, "")]
    : [landing(target), landing(root)];

  return path === base || path.startsWith(`${base}/`);
}

/// A folder Kyuren may read, and what it may do to it.
export type Place = {
  path: string;
  mode: "read" | "ask" | "write";
  /// Kept by Kyuren for itself rather than being the user's notes: it decides where a write may
  /// land and nothing about a read, which is judged as though it were not there.
  own?: true;
};

function notes(places: Place[]): Place[] {
  return places.filter((one) => one.own !== true);
}

/// Where a write would land, if anywhere. The innermost vault wins, so a folder connected inside
/// another is governed by its own setting rather than its parent's.
function placeOf(target: string, places: Place[]): Place | undefined {
  return places
    .filter((place) => within(target, place.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/// Files that hold a secret wherever they are kept.
const SECRET_NAME = /^(\.env(\..+)?|.+\.env|id_(rsa|dsa|ecdsa|ed25519)(_sk)?|.+\.(pem|p12|pfx|p8|key|kdbx))$/;

/// The parts of the Library where a person's own documents are kept, synced from elsewhere.
const DOCUMENTS_IN_LIBRARY = ["Library/Mobile Documents", "Library/CloudStorage"];

/// The Data volume's own name for what is also at the root, as the home folders are.
const DATA_VOLUME = /^\/system\/volumes\/data(?=\/)/i;

/// A path as the disk would compare it: by the same folder's name at the root rather than on the
/// Data volume, and with its accents composed one way, as either may be spelled.
function plain(path: string): string {
  return resolve(path).replace(DATA_VOLUME, "").normalize("NFC");
}

/// Whether a read would open a secret, which once read is one step from leaving. In the home folder
/// what is hidden is where programs keep keys, tokens and histories, and the Library is where apps
/// keep theirs; a connected vault is the user's to read, but for what is hidden inside it.
/// Compared without case, as the disk compares names.
function secret(target: string | undefined, places: Place[]): boolean {
  if (!target?.startsWith("/")) return false;
  const path = plain(target);
  if (SECRET_NAME.test(basename(path).toLowerCase())) return true;
  const where = landing(path);
  const place = placeOf(path, notes(places));
  const home = plain(homedir());
  const base = place?.path ?? (within(where, home) ? home : undefined);
  if (base === undefined) return false;
  if (relative(landing(base), where).split("/").some((part) => part.startsWith("."))) return true;
  if (place) return false;
  const inside = (folder: string) => within(where, join(home, folder));
  return inside("Library") && !DOCUMENTS_IN_LIBRARY.some(inside);
}

/// Whether an action sends something off this machine: reaching out, or writing somewhere that is
/// not on it.
export function leaves(action: Action): boolean {
  return action.effect === "outbound" || (action.effect === "write" && remote(action.target));
}

/// Whether a path, or an address of a collection elsewhere, lies inside a connected vault, however
/// either is spelled and whichever way the vault was connected.
export function inVault(target: string | undefined, places: Place[]): boolean {
  return target !== undefined && placeOf(target, notes(places)) !== undefined;
}

/// An action as it is written down: where it went, not what it carried, which may be the user's notes.
export function bare(action: Action): Action {
  const { carrying, ...kept } = action;
  return carrying === undefined ? action : kept;
}

/// Reads and computation pass, but for a read of a secret. A write is judged by where it would
/// land. Anything that leaves the machine or runs code asks. Three classes are never automated at
/// all, regardless of what the user has previously approved.
export function classify(action: Action, places: Place[]): Verdict {
  switch (action.effect) {
    case "credential":
    case "financial":
    case "destroy":
      return "deny";
    case "read":
      return secret(action.target, places) || secret(action.through, places) ? "ask" : "allow";
    // Someone's calendar, mail or notes, held on this machine. It never leaves, so it is not
    // outbound, but it is not an ordinary read either and is not automated.
    case "personal":
      return "ask";
    case "write": {
      const place = placeOf(action.target, places);
      if (!place) return "ask";
      // A vault marked read only is refused rather than asked about, so no earlier approval and
      // nothing written inside it can turn into permission to write there.
      if (place.mode === "read") return "deny";
      return place.mode === "write" ? "allow" : "ask";
    }
    case "execute":
    case "outbound":
      return "ask";
  }
}

function normalise(effect: Effect, target: string): string {
  if (effect === "outbound") {
    try {
      const url = new URL(target);
      // All of an address but its fragment leaves the machine, so all of it is what is approved:
      // one that left out the query would carry anything at all to the page approved.
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/$/, "")}${url.search}`;
    } catch {
      return target.trim().toLowerCase();
    }
  }
  if (effect === "write" || effect === "read" || effect === "destroy") {
    return remote(target) ? target.trim().toLowerCase().replace(/\/+$/, "") : resolve(target);
  }
  return target.trim();
}

/// Remembered approvals are keyed by what an action actually does, not by the tool that does it.
/// A tool name alone would let one approval authorise every later use of that tool on any target.
export function fingerprint(action: Action): string {
  return JSON.stringify([action.tool, action.effect, normalise(action.effect, action.target)]);
}
