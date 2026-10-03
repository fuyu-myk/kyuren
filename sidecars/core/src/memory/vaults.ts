import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");

/// Where Kyuren writes. Always connected and never removable, because the days it writes have to
/// land somewhere it is allowed to keep them.
export const ownVault = process.env.KYUREN_VAULT ?? join(root, "vault");

const listed = join(root, "vaults.json");

/// What Kyuren may do to a folder.
///
/// `read` is a refusal, not a question: a vault marked read only is never written to, whatever has
/// been approved before and whatever any file inside it says. `ask` is for notes with conventions
/// worth following but consequences worth seeing first. `write` is for what Kyuren keeps itself.
export const MODES = ["read", "ask", "write"] as const;
export type Mode = (typeof MODES)[number];

export type Vault = {
  path: string;
  mode: Mode;
};

/// A folder someone already keeps is read only until they say otherwise. Connecting your notes is
/// not the same as handing them over, and the safe default is the one that cannot lose work.
export const DEFAULT_MODE: Mode = "read";

function modeOf(given: unknown): Mode | undefined {
  return MODES.find((one) => one === given);
}

/// Plain text rather than the keychain: a folder someone chose is not a secret, and being able to
/// see and edit the list without the application running is the point of keeping notes as files.
export function vaults(): Vault[] {
  let added: Vault[] = [];

  try {
    const held = JSON.parse(readFileSync(listed, "utf8")) as { vaults?: unknown };
    if (Array.isArray(held.vaults)) {
      added = held.vaults.flatMap((one): Vault[] => {
        if (typeof one === "string") return [{ path: resolve(one), mode: DEFAULT_MODE }];
        if (one && typeof one === "object" && typeof (one as Vault).path === "string") {
          const entry = one as { path: string; mode?: unknown };
          return [{ path: resolve(entry.path), mode: modeOf(entry.mode) ?? DEFAULT_MODE }];
        }
        return [];
      });
    }
  } catch {
    // No list yet, or one written by hand and broken. Kyuren's own vault is enough to work with.
  }

  const byPath = new Map<string, Vault>();
  byPath.set(ownVault, { path: ownVault, mode: "write" });
  for (const one of added) {
    if (one.path !== ownVault) byPath.set(one.path, one);
  }

  return [...byPath.values()];
}

export function vaultPaths(): string[] {
  return vaults().map((one) => one.path);
}

function save(all: Vault[]): Vault[] {
  const added = all.filter((one) => one.path !== ownVault);
  mkdirSync(dirname(listed), { recursive: true });
  writeFileSync(listed, `${JSON.stringify({ vaults: added }, null, 2)}\n`, "utf8");
  return vaults();
}

export function addVault(path: string, mode: Mode = DEFAULT_MODE): Vault[] {
  const where = resolve(path);
  return save([...vaults().filter((one) => one.path !== where), { path: where, mode }]);
}

export function setMode(path: string, mode: Mode): Vault[] {
  const where = resolve(path);
  if (where === ownVault && mode !== "write") {
    throw new Error("Kyuren's own vault is where it keeps what it writes");
  }
  if (!vaults().some((one) => one.path === where)) {
    throw new Error(`${path} is not a connected vault`);
  }
  return save(vaults().map((one) => (one.path === where ? { ...one, mode } : one)));
}

export function removeVault(path: string): Vault[] {
  const going = resolve(path);
  if (going === ownVault) throw new Error("Kyuren's own vault cannot be disconnected");
  return save(vaults().filter((one) => one.path !== going));
}
