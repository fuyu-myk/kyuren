import { useCallback, useEffect, useState } from "react";
import { onAnswered, onPermission, onTrouble, resolvePermission, type PermissionRequest } from "@/agent";
import { PANES, type Pane } from "@/panes";
import { Place } from "@/Place";
import { System } from "@/System";

type Where = Pane | "system";

/// The window: a rail of places to be, one of them showing, and whatever is being asked for
/// permission over the top of all of it.
export function App() {
  const [where, setWhere] = useState<Where>("chat");
  const [questions, setQuestions] = useState<PermissionRequest[]>([]);
  const [trouble, setTrouble] = useState<string>();

  useEffect(() => {
    const pending = onPermission((request) =>
      setQuestions((was) => (was.some((one) => one.id === request.id) ? was : [...was, request])),
    );
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  // The island asks every question as well; answered there, it is gone from here.
  useEffect(() => {
    const pending = onAnswered((id) => setQuestions((was) => was.filter((one) => one.id !== id)));
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    const pending = onTrouble(setTrouble);
    return () => void pending.then((unlisten) => unlisten());
  }, []);

  const go = useCallback((place: Where) => setWhere(place), []);

  const answer = (id: string, allow: boolean) => {
    setQuestions((was) => was.filter((one) => one.id !== id));
    void resolvePermission(id, allow);
  };
  const asking = questions[0];

  return (
    <main className="workspace">
      <div className="handle" data-tauri-drag-region />
      <nav className="rail">
        <h1 data-tauri-drag-region>Kyuren</h1>
        {PANES.map((pane) => (
          <button
            key={pane.key}
            type="button"
            className={where === pane.key ? "here" : ""}
            onClick={() => go(pane.key)}
          >
            {pane.title}
          </button>
        ))}
        <button
          type="button"
          className={where === "system" ? "here system" : "system"}
          onClick={() => go("system")}
        >
          system
        </button>
      </nav>

      <section className="view">
        {where === "system" ? <System /> : <Place key={where} pane={where} />}
      </section>

      {asking ? (
        <div className="asking">
          <p>
            Allow <strong>{asking.tool}</strong> to {asking.effect}
          </p>
          <code>{asking.target}</code>
          {asking.carrying ? (
            <>
              <p>sending</p>
              <code>{asking.carrying}</code>
            </>
          ) : null}
          {asking.why ? <p className="why">asked because {asking.why}</p> : null}
          <div className="actions">
            <button type="button" className="refuse" onClick={() => answer(asking.id, false)}>
              deny
            </button>
            <button type="button" className="agree" onClick={() => answer(asking.id, true)}>
              allow
            </button>
          </div>
        </div>
      ) : null}

      {trouble ? <p className="error afloat">{trouble}</p> : null}
    </main>
  );
}
