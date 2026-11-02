import { useState } from "react";
import { forgetSecret, SKILL_KEY, storeSecret } from "@/connect";

type Props = {
  credential: string;
  /// The one host the key is kept for: a skill elsewhere naming the same credential is not given it.
  host: string;
  held: boolean;
  /// Told once a key is kept or forgotten, for the pane to ask again which are held.
  onChanged: () => void;
};

/// Where a skill's key is given, by the person and never by Kyuren, straight to the keychain. It is
/// not shown again once kept, nor read back: only whether one is held.
export function SkillKey({ credential, host, held, onChanged }: Props) {
  const [typed, setTyped] = useState("");
  const [trouble, setTrouble] = useState<string>();
  const name = `${SKILL_KEY}${credential}@${host}`;

  const keep = async () => {
    try {
      await storeSecret(name, typed);
      setTyped("");
      setTrouble(undefined);
      onChanged();
    } catch (failure) {
      setTrouble(String(failure));
    }
  };

  const forget = async () => {
    try {
      await forgetSecret(name);
      setTrouble(undefined);
      onChanged();
    } catch (failure) {
      setTrouble(String(failure));
    }
  };

  return (
    <>
      {held ? (
        <p className="connected key">
          the key for <strong>{credential}</strong> is in the keychain
          <button type="button" className="quiet" onClick={() => void forget()}>
            forget
          </button>
        </p>
      ) : (
        <div className="connecting key">
          <input
            type="password"
            value={typed}
            placeholder={`the key for ${credential}`}
            aria-label={`the key for ${credential}`}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && typed.trim() !== "") void keep();
            }}
          />
          <button type="button" disabled={typed.trim() === ""} onClick={() => void keep()}>
            keep
          </button>
        </div>
      )}
      {trouble ? <p className="broke">{trouble}</p> : null}
    </>
  );
}
