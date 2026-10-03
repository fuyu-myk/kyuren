import { homedir } from "node:os";
import { join } from "node:path";
import { Memory } from "#memory/memory.ts";
import { ownVault, vaultPaths, vaults } from "#memory/vaults.ts";

const root = process.env.KYUREN_HOME ?? join(homedir(), ".kyuren");

/// The index sits with Kyuren's own files, not inside a vault someone else owns. A folder
/// connected from elsewhere is read and never written to.
const indexPath = join(root, "index", "memory.db");

export { ownVault, vaultPaths, vaults };

let held: Memory | undefined;

/// One index for the process. Two would mean two answers to the same question and two copies of
/// every embedding, and the index is a cache of the notes rather than anything a caller owns.
export function sharedMemory(): Memory {
  held ??= new Memory(vaultPaths, indexPath);
  return held;
}
