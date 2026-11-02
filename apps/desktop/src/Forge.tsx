import { useCallback, useEffect, useState } from "react";
import { skillKeysHeld } from "@/connect";
import { changesOf, hostOf, keyFor, keyText, lookalike } from "@/changes";
import { approveSkill, forgetSkill, listSkills, type Skill } from "@/sessions";
import { SkillKey } from "@/SkillKey";
import { ago } from "@/when";

/// What Kyuren has taught itself, and what standing each of those things has.
///
/// A pending skill is shown in full, address and all, because approving it is agreeing to that
/// request rather than to its name.
export function Forge({ onImprove, onChanged }: { onImprove?: (skill: Skill) => void; onChanged?: () => void }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [held, setHeld] = useState<string[]>([]);
  const [asking, setAsking] = useState<string>();
  const [trouble, setTrouble] = useState<string>();
  /// Said when an approval did not take, since the skill changed while it was on screen.
  const [notice, setNotice] = useState<string>();

  const look = useCallback(async () => {
    try {
      const listed = await listSkills();
      setSkills(listed);
      const named = listed.map((one) => keyFor(one)).filter((one): one is string => one !== undefined);
      setHeld(await skillKeysHeld([...new Set(named)]));
      setTrouble(undefined);
    } catch (failure) {
      setTrouble(String(failure));
    }
  }, []);

  useEffect(() => {
    void look();
    const again = window.setInterval(() => void look(), 20_000);
    return () => window.clearInterval(again);
  }, [look]);

  if (trouble) return <p className="error">{trouble}</p>;
  if (skills.length === 0) return <p className="empty">nothing has been forged yet</p>;

  return (
    <>
      {notice ? <p className="error">{notice}</p> : null}
      <ul className="forged">
        {skills.map((one) => (
          <li key={one.id} className={one.state}>
            <div className="heading">
              <span className="name">{one.name}</span>
              <span className={`standing ${one.state}`}>{one.state}</span>
              <span className="when">{ago(one.drafted)}</span>
            </div>

            <p className="about">{one.about}</p>
            <p className="request">
              <span className="method">{one.method}</span>
              <span className="url">{one.url}</span>
              <span className="reads">reads {one.reads}</span>
            </p>
            {lookalike(one.url) ? <p className="broke">this address really goes to {lookalike(one.url)}</p> : null}

            {one.parameters.length > 0 ? (
              <p className="takes">
                {one.parameters.map((each) => (
                  <span key={each.name}>
                    {each.name}
                    <em>
                      {each.kind} in {each.in}
                      {each.required ? ", needed" : ""}
                    </em>
                  </span>
                ))}
              </p>
            ) : null}

            {Object.keys(one.headers).length > 0 ? (
              <p className="takes">
                {Object.entries(one.headers).map(([name, value]) => (
                  <span key={name}>
                    {name}
                    <em>{value}</em>
                  </span>
                ))}
              </p>
            ) : null}

            {one.auth.mode !== "none" ? (
              <p className="takes">
                <span>
                  key
                  <em>{keyText(one.auth)}, kept for {hostOf(one.url)}</em>
                </span>
              </p>
            ) : null}
            {one.auth.mode !== "none" && one.auth.credential ? (
              <SkillKey credential={one.auth.credential} host={hostOf(one.url)} held={held.includes(keyFor(one) ?? "")} onChanged={() => void look()} />
            ) : null}

            {one.trouble ? <p className="broke">{one.trouble}</p> : null}

            {one.before ? (
              <div className="changed">
                <p className="why">changed since approved{one.why ? `: ${one.why}` : ""}</p>
                {changesOf(one).map((each) => (
                  <p key={each.what} className="change">
                    <span className="what">{each.what}</span>
                    <del>{each.was}</del>
                    <ins>{each.now}</ins>
                  </p>
                ))}
              </div>
            ) : null}

            <div className="actions">
              {asking === one.id ? (
                <>
                  <button type="button" className="ghost" onClick={() => setAsking(undefined)}>
                    cancel
                  </button>
                  <button
                    type="button"
                    className="ghost sure"
                    onClick={() => {
                      setAsking(undefined);
                      void forgetSkill(one.id).then(look).then(onChanged);
                    }}
                  >
                    confirm
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="ghost" onClick={() => setAsking(one.id)}>
                    discard
                  </button>
                  {onImprove && one.state !== "pending" ? (
                    <button type="button" className="ghost" onClick={() => onImprove(one)}>
                      {one.state === "broken" ? "mend" : "improve"}
                    </button>
                  ) : null}
                  {one.state === "approved" ? null : (
                    <button
                      type="button"
                      className="ghost allow"
                      onClick={() =>
                        void approveSkill(one.id, one.drafted).then(async (approved) => {
                          // Changed while it was on screen, so what was approved would not be what was seen.
                          setNotice(approved ? undefined : `${one.name} changed since it was shown; look at it again before approving`);
                          await look();
                          onChanged?.();
                        })
                      }
                    >
                      {one.state === "broken" ? "approve again" : "approve"}
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
