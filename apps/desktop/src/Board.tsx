import { useCallback, useEffect, useState } from "react";
import { openLink } from "@/links";
import { afterFew, FEW, More } from "@/More";
import { projectBoard, type Checks, type Project, type Review } from "@/sessions";
import { ago } from "@/when";

type BoardProps = {
  onAsk: (about: Project) => void;
};

/// How a project's checks are said: only those there are.
const CHECKS: Record<Exclude<Checks, "none">, string> = { passing: "passing", failing: "failing", pending: "checking" };
/// How many of a project's open pull requests are listed under it; the rest are counted.
const PULLS = 3;

/// How often the board takes a fresh reading on its own. Nobody should have to press anything to
/// find out that a branch moved.
const AGAIN = 30_000;

export function Board({ onAsk }: BoardProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [all, setAll] = useState(false);
  const [trouble, setTrouble] = useState<string>();

  const look = useCallback(async (fresh: boolean) => {
    try {
      const board = await projectBoard(fresh);
      setProjects(board.projects);
      setReviews(board.reviews);
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
    {reviews.length > 0 ? (
      <section className="reviews">
        <h4>waiting on your review</h4>
        <ul>
          {reviews.map((review) => (
            <li key={review.url}>
              <button type="button" className="pull" title={review.url} onClick={() => void openLink(review.url)}>
                <span className="repo">{review.repo}</span>
                <span className="number">#{review.number}</span>
                <span className="title">{review.title}</span>
                {review.author ? <span className="by">by {review.author}</span> : null}
                {review.draft ? <em className="draft">draft</em> : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
    ) : null}
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
              {one.github && one.github.main !== "none" ? (
                <em className={`ci ${one.github.main}`}>
                  {one.github.branch ?? "main"} {CHECKS[one.github.main]}
                </em>
              ) : null}
            </span>
          </button>
          {one.github && one.github.pulls.length > 0 ? (
            <ul className="pulls">
              {one.github.pulls.slice(0, PULLS).map((pull) => (
                <li key={pull.number}>
                  <button type="button" className="pull" title={pull.url} onClick={() => void openLink(pull.url)}>
                    <span className={`checks ${pull.checks}`} title={pull.checks === "none" ? "no checks" : `checks ${CHECKS[pull.checks]}`} />
                    <span className="number">#{pull.number}</span>
                    <span className="title">{pull.title}</span>
                    {pull.draft ? <em className="draft">draft</em> : null}
                  </button>
                </li>
              ))}
              {one.github.count > PULLS ? <li className="others">{one.github.count - PULLS} more open</li> : null}
            </ul>
          ) : null}
          {one.decisions && one.decisions.count > 0 ? (
            <ul className="decided">
              {one.decisions.latest.map((made) => (
                <li key={`${made.at}:${made.topic}`} title={made.question ?? made.topic}>
                  <span className="topic">{made.topic}</span>
                  <span className="said">{made.said}</span>
                  <span className="when">{ago(made.at)}</span>
                </li>
              ))}
              {one.decisions.count > one.decisions.latest.length ? <li className="others">{one.decisions.count - one.decisions.latest.length} decided before</li> : null}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
    <More total={projects.length} all={all} onToggle={() => setAll((was) => !was)} />
    </>
  );
}
