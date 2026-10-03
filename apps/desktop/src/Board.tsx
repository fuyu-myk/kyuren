import { useCallback, useEffect, useState } from "react";
import { afterFew, FEW, More } from "@/More";
import { projectBoard, type Project } from "@/sessions";
import { ago } from "@/when";

type BoardProps = {
  onAsk: (about: Project) => void;
};

/// How often the board takes a fresh reading on its own. Nobody should have to press anything to
/// find out that a branch moved.
const AGAIN = 30_000;

export function Board({ onAsk }: BoardProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [all, setAll] = useState(false);
  const [trouble, setTrouble] = useState<string>();

  const look = useCallback(async (fresh: boolean) => {
    try {
      setProjects(await projectBoard(fresh));
      setTrouble(undefined);
    } catch (failure) {
      setTrouble(String(failure));
    }
  }, []);

  useEffect(() => {
    void look(false);
    const timer = window.setInterval(() => void look(true), AGAIN);
    // Coming back to the window is the moment something is most likely to have changed.
    const back = (): void => void look(true);
    window.addEventListener("focus", back);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", back);
    };
  }, [look]);

  if (trouble) return <p className="error">{trouble}</p>;
  if (projects.length === 0) return <p className="empty">no repositories found</p>;

  const shown = all ? projects : projects.slice(0, FEW);

  return (
    <>
    <ul className="board">
      {shown.map((one, at) => (
        <li key={one.path} className={all ? "fresh" : ""} style={all ? afterFew(at) : undefined}>
          <button type="button" className="project" onClick={() => onAsk(one)}>
            <span className="what">
              <span className="name">{one.name}</span>
              <span className="branch">{one.branch}</span>
            </span>
            <span className="when">{one.lastAt ? ago(one.lastAt) : "no commits"}</span>
            <span className="standing">
              {one.ahead > 0 ? <em className="ahead">{one.ahead} unpushed</em> : null}
              {one.behind > 0 ? <em className="behind">{one.behind} behind</em> : null}
              {one.dirty > 0 ? <em className="dirty">{one.dirty} uncommitted</em> : null}
              {one.upstream ? null : <em className="alone">never pushed</em>}
            </span>
          </button>
        </li>
      ))}
    </ul>
    <More total={projects.length} all={all} onToggle={() => setAll((was) => !was)} />
    </>
  );
}
