import { useCallback, useEffect, useState } from "react";
import { islandShortcuts, setIslandShortcuts } from "@/notch";
import { approvePlaybook, listPlaybooks, readPlaybook, rejectPlaybook, repairPlaybook, type Listed, type Read } from "@/playbook";

type Props = { onTrouble: (message: string) => void };

function when(at: string): string {
  return at ? at.slice(0, 16).replace("T", " ") : "";
}

/// What Kyuren knows how to do by the book. A pending playbook shows its diff and waits for the
/// user; the recent runs of each say how it has been going.
export function Playbooks({ onTrouble }: Props) {
  const [listed, setListed] = useState<Listed[]>();
  const [open, setOpen] = useState<Read>();
  const [busy, setBusy] = useState<string>();
  /// The approved playbooks the notch offers as shortcuts.
  const [onNotch, setOnNotch] = useState<string[]>([]);

  const read = useCallback(async () => {
    try {
      setListed(await listPlaybooks());
    } catch {
      setListed(undefined);
    }
  }, []);

  useEffect(() => {
    void read();
    void islandShortcuts().then(setOnNotch).catch(() => setOnNotch([]));
  }, [read]);

  const toggleNotch = async (name: string) => {
    const next = onNotch.includes(name) ? onNotch.filter((one) => one !== name) : [...onNotch, name];
    try {
      setOnNotch(await setIslandShortcuts(next));
    } catch (failure) {
      onTrouble(String(failure));
    }
  };

  const look = async (name: string) => {
    try {
      setOpen(await readPlaybook(name));
    } catch (failure) {
      onTrouble(String(failure));
    }
  };

  const decide = async (name: string, approve: boolean) => {
    setBusy(name);
    try {
      await (approve ? approvePlaybook(name) : rejectPlaybook(name));
      setOpen(undefined);
      await read();
    } catch (failure) {
      onTrouble(String(failure));
    } finally {
      setBusy(undefined);
    }
  };

  const repair = async (name: string) => {
    setBusy(name);
    try {
      const repaired = await repairPlaybook(name);
      if (!repaired.pending) onTrouble(`no repair was proposed: ${repaired.said.slice(0, 200)}`);
      await read();
      if (repaired.pending) setOpen(await readPlaybook(name));
    } catch (failure) {
      onTrouble(String(failure));
    } finally {
      setBusy(undefined);
    }
  };

  const pendingCount = listed?.filter((one) => one.pending).length ?? 0;
  const lastFailed = (name: string) => listed?.find((one) => one.name === name)?.recent[0]?.outcome === "failed";

  return (
    <section>
      <h3>playbooks</h3>
      <p className="hint">
        {listed === undefined
          ? "asking"
          : listed.length === 0
            ? "none yet; a playbook is written by the cloud model or a Claude Code session and waits here for your approval"
            : `${listed.length} playbook${listed.length === 1 ? "" : "s"}${pendingCount ? `, ${pendingCount} waiting for approval` : ""}`}
      </p>
      {listed && listed.length > 0 ? (
        <ul className="rows">
          {listed.map((one) => (
            <li key={one.name} className={`row ${one.pending ? "row-up" : ""}`}>
              <span className="dot" />
              <span className="label">{one.pending ? "pending" : "approved"}</span>
              <span className="detail">
                <button type="button" className="ghost" onClick={() => void look(one.name)}>
                  {one.name}
                </button>
                {one.when ? ` for ${one.when}` : ""}
                {one.recent.length
                  ? ` · last run ${one.recent[0]?.outcome} at ${when(one.recent[0]?.startedAt ?? "")}`
                  : ""}
              </span>
              {one.approved ? (
                <span className="actions">
                  <button
                    type="button"
                    className={onNotch.includes(one.name) ? "on" : undefined}
                    aria-pressed={onNotch.includes(one.name)}
                    title="a shortcut on the notch"
                    onClick={() => void toggleNotch(one.name)}
                  >
                    on the notch
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open ? (
        <div className="playbook">
          <p className="hint">
            {open.pending
              ? open.approved
                ? `a repair of ${open.name}, version ${open.pending.version}, by ${open.pending.author}`
                : `a new playbook, ${open.name}, by ${open.pending.author}`
              : `${open.name}, version ${open.approved?.version ?? "?"}, approved ${open.approved?.approved ?? ""}`}
          </p>
          <pre className="diff">{open.pending ? open.diff : (open.approved?.steps ?? []).map((step, at) => `${at + 1}. ${step}`).join("\n")}</pre>
          {open.pending ? (
            <div className="actions">
              <button type="button" onClick={() => void decide(open.name, true)} disabled={busy === open.name}>
                approve
              </button>
              <button type="button" className="danger" onClick={() => void decide(open.name, false)} disabled={busy === open.name}>
                reject
              </button>
              <button type="button" className="ghost" onClick={() => setOpen(undefined)}>
                close
              </button>
            </div>
          ) : (
            <div className="actions">
              {lastFailed(open.name) ? (
                <button type="button" onClick={() => void repair(open.name)} disabled={busy === open.name}>
                  {busy === open.name ? "repairing" : "repair from the last run"}
                </button>
              ) : null}
              <button type="button" className="ghost" onClick={() => setOpen(undefined)}>
                close
              </button>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
