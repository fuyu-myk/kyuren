import { useCallback, useEffect, useState } from "react";
import {
  connectVault,
  disconnectVault,
  listVaults,
  MODES,
  pickFolder,
  setVaultMode,
  type Built,
  type Mode,
  type Vaults as Listed,
} from "@/vaults";

type Props = { onTrouble: (message: string) => void };

/// What Kyuren may do to a folder, in the words a person would use.
const MEANING: Record<Mode, string> = {
  read: "read only",
  ask: "asks before writing",
  write: "may write",
};

export function Notes({ onTrouble }: Props) {
  const [listed, setListed] = useState<Listed>();
  const [busy, setBusy] = useState<string>();
  const [built, setBuilt] = useState<Built>();

  const read = useCallback(async () => {
    try {
      setListed(await listVaults());
    } catch {
      setListed(undefined);
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const connect = async () => {
    const path = await pickFolder().catch(() => undefined);
    if (!path) return;
    setBusy(path);
    try {
      const done = await connectVault(path);
      setListed((was) => (was ? { ...was, vaults: done.vaults } : was));
      setBuilt(done.built);
    } catch (failure) {
      onTrouble(String(failure));
    } finally {
      setBusy(undefined);
    }
  };

  const change = async (path: string, mode: Mode) => {
    try {
      const done = await setVaultMode(path, mode);
      setListed((was) => (was ? { ...was, vaults: done.vaults } : was));
    } catch (failure) {
      onTrouble(String(failure));
    }
  };

  const drop = async (path: string) => {
    setBusy(path);
    try {
      const done = await disconnectVault(path);
      setListed((was) => (was ? { ...was, vaults: done.vaults } : was));
      setBuilt(done.built);
    } catch (failure) {
      onTrouble(String(failure));
    } finally {
      setBusy(undefined);
    }
  };

  const shown = (path: string) =>
    listed && path.startsWith(listed.home) ? `~${path.slice(listed.home.length)}` : path;

  return (
    <section>
      <h3>notes</h3>
      <p className="hint">
        {listed === undefined
          ? "asking"
          : `${listed.vaults.length} folder${listed.vaults.length === 1 ? "" : "s"}; one you connect is read only until you say otherwise`}
        {built ? `; ${built.files} notes, ${built.chunks} pieces, ${built.embedded} newly read` : ""}
      </p>
      {listed ? (
        <ul className="rows">
          {listed.vaults.map((one) => {
            const own = one.path === listed.own;
            return (
              <li key={one.path} className="row row-up vault">
                <span className="dot" />
                <span className="label">{own ? "kyuren's own" : "vault"}</span>
                <span className="detail">{shown(one.path)}</span>
                {own ? (
                  <span className="mode">{MEANING.write}</span>
                ) : (
                  <select
                    className="mode"
                    value={one.mode}
                    onChange={(event) => void change(one.path, event.target.value as Mode)}
                  >
                    {MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {MEANING[mode]}
                      </option>
                    ))}
                  </select>
                )}
                {own ? null : (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void drop(one.path)}
                    disabled={busy === one.path}
                  >
                    disconnect
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="actions">
        <button type="button" onClick={() => void connect()} disabled={busy !== undefined}>
          {busy ? "reading" : "connect an Obsidian vault"}
        </button>
      </div>
    </section>
  );
}
