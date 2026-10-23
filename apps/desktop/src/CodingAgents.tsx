import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { insideTauri } from "@/tauri";

type HookState = { present: boolean; on: boolean; stale?: boolean; trouble?: string };
type Found = { claude: HookState; listening: boolean };

type Props = { onTrouble: (message: string) => void };

/// Whether what a coding agent asks the user comes to the island. Switching it on edits the
/// agent's own settings file, so it is only ever done from here, by the user.
export function CodingAgents({ onTrouble }: Props) {
  const [claude, setClaude] = useState<HookState>();
  const [listening, setListening] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!insideTauri()) {
      setClaude({ present: true, on: false });
      return;
    }
    void invoke<Found>("coding_hooks")
      .then((found) => {
        setClaude(found.claude);
        setListening(found.listening);
      })
      .catch((failure) => onTrouble(String(failure)));
  }, [onTrouble]);

  const set = async (on: boolean) => {
    setBusy(true);
    try {
      const found = insideTauri() ? await invoke<Found>("coding_hooks_set", { on }) : { claude: { present: true, on }, listening: true };
      setClaude(found.claude);
      setListening(found.listening);
    } catch (failure) {
      onTrouble(String(failure));
    } finally {
      setBusy(false);
    }
  };

  const hint =
    claude === undefined
      ? "asking"
      : !claude.present
        ? "Claude Code is not installed for this user."
        : claude.trouble
          ? claude.trouble
          : claude.on && !listening
            ? "On, but Kyuren is not listening for it, so Claude Code asks in its own window. Switch it off and on to try again."
            : claude.on && claude.stale
              ? "On, as an earlier Kyuren set it up: only its permissions come to the island. Switch it off and on to bring its plans, edits, questions and its servers' forms too."
              : claude.on
                ? "A permission, a plan, an edit, questions to choose among and a form one of its servers asks for come to the island, each shown whole, and are held there before Claude Code asks in its own window: a permission for up to 45 seconds, the rest for up to 115. Anything it cannot show whole Claude Code asks itself. Its settings were copied to ~/.kyuren/backups first."
                : "Off. Switched on, three hooks go into ~/.claude/settings.json beside its own, after a copy of the file is kept.";

  return (
    <section>
      <h3>coding agents</h3>
      <div className="actions">
        <button
          type="button"
          className={claude?.on ? "on" : undefined}
          aria-pressed={claude?.on ?? false}
          disabled={busy || !claude?.present}
          onClick={() => void set(!claude?.on)}
        >
          Claude Code asks on the island
        </button>
      </div>
      <p className="hint">{hint}</p>
    </section>
  );
}
