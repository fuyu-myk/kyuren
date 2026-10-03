import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export const MODES = ["read", "ask", "write"] as const;
export type Mode = (typeof MODES)[number];

export type Vault = { path: string; mode: Mode };

export type Vaults = {
  vaults: Vault[];
  /// Kyuren's own vault, always connected and always written to.
  own: string;
  home: string;
};

export type Built = { files: number; chunks: number; embedded: number; tookMs: number };

export function listVaults(): Promise<Vaults> {
  return invoke<Vaults>("vaults_list");
}

export function connectVault(path: string): Promise<{ vaults: Vault[]; built: Built }> {
  return invoke("vault_connect", { path });
}

export function disconnectVault(path: string): Promise<{ vaults: Vault[]; built: Built }> {
  return invoke("vault_disconnect", { path });
}

export function setVaultMode(path: string, mode: Mode): Promise<{ vaults: Vault[] }> {
  return invoke("vault_mode", { path, mode });
}

/// A folder chosen in the system's own picker, so nothing is typed and nothing is mistyped.
export async function pickFolder(): Promise<string | undefined> {
  const chosen = await open({ directory: true, multiple: false, title: "Choose a vault" });
  return typeof chosen === "string" ? chosen : undefined;
}
