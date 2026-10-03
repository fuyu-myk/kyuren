import { useCallback, useEffect, useState } from "react";
import { setWebEngine, setWebFallback, trySearch, webEngine, type Engine, type Searched } from "@/reach";

type Props = { onTrouble: (message: string) => void };

/// The web, read through a hidden window of Kyuren's own. The engine is a template the user may
/// change, and a search can be tried here to see both working.
export function Web({ onTrouble }: Props) {
  const [engine, setEngine] = useState<Engine>();
  const [typed, setTyped] = useState("");
  const [typedFallback, setTypedFallback] = useState("");
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState<Searched>();
  const found = searched?.results;
  const [busy, setBusy] = useState(false);

  const read = useCallback(async () => {
    try {
      const got = await webEngine();
      setEngine(got);
      setTyped(got.set ?? "");
      setTypedFallback(got.fallbackSet ?? "");
    } catch {
      setEngine(undefined);
    }
  }, []);

  useEffect(() => {
    void read();
  }, [read]);

  const save = async (which: "engine" | "fallback") => {
    try {
      await (which === "engine" ? setWebEngine(typed) : setWebFallback(typedFallback));
      await read();
    } catch (failure) {
      onTrouble(String(failure));
    }
  };

  const search = async () => {
    if (query.trim() === "") return;
    setBusy(true);
    try {
      setSearched(await trySearch(query));
    } catch (failure) {
      onTrouble(String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h3>web</h3>
      <p className="hint">
        {engine === undefined
          ? "asking"
          : `read through Kyuren's own hidden browser; searches go to ${engine.live}${engine.set ? "" : ", the default"}, and to ${engine.fallbackLive}${engine.fallbackSet ? "" : ", the default"} when that one refuses or finds nothing`}
      </p>
      <div className="connecting">
        <input
          type="text"
          value={typed}
          placeholder="engine, with {query} where the words go; empty for the default"
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
        />
        <button type="button" onClick={() => void save("engine")}>
          set engine
        </button>
      </div>
      <div className="connecting">
        <input
          type="text"
          value={typedFallback}
          placeholder="second engine, for when the first refuses; empty for the default"
          spellCheck={false}
          onChange={(event) => setTypedFallback(event.target.value)}
        />
        <button type="button" onClick={() => void save("fallback")}>
          set second
        </button>
      </div>
      <div className="connecting">
        <input
          type="text"
          value={query}
          placeholder="try a search"
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search();
          }}
        />
        <button type="button" onClick={() => void search()} disabled={busy}>
          {busy ? "searching" : "search"}
        </button>
      </div>
      {searched ? (
        <p className="hint">
          {`from ${searched.from}`}
          {searched.tried.length ? `, after ${searched.tried.map((one) => `${one.engine}: ${one.reason}`).join("; ")}` : ""}
        </p>
      ) : null}
      {found ? (
        found.length === 0 ? (
          <p className="hint">nothing came back</p>
        ) : (
          <ul className="rows">
            {found.map((one) => (
              <li key={one.url} className="row">
                <span className="dot" />
                <span className="label">result</span>
                <span className="detail">
                  {one.title}
                  <br />
                  {one.url}
                  {one.snippet ? <><br />{one.snippet}</> : null}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
