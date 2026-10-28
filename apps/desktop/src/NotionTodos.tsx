import { useEffect, useState } from "react";
import { chooseNotionTodos, notionTodos, type NotionTodos as Chosen } from "@/connect";

type Props = {
  /// The services connected, so the databases are looked for again once Notion is.
  connected: string[];
  onTrouble: (message: string) => void;
};

/// Which Notion database the island's todos are kept in. Choosing one is the leave for Kyuren to
/// read Notion, and to write to that database and no other.
export function NotionTodos({ connected, onTrouble }: Props) {
  const [state, setState] = useState<Chosen>();
  const notion = connected.includes("notion");

  useEffect(() => {
    void notionTodos().then(setState).catch((failure) => onTrouble(String(failure)));
  }, [notion, onTrouble]);

  const choose = async (id: string | null) => {
    try {
      setState(await chooseNotionTodos(id));
    } catch (failure) {
      onTrouble(String(failure));
    }
  };

  if (!state) return null;
  return (
    <section>
      <h3>todos</h3>
      {!state.connected ? (
        <p className="hint">Connect Notion below with an integration token, then share a database with the integration to keep the island's todos there.</p>
      ) : state.databases.length === 0 ? (
        <p className="hint">No database is shared with Kyuren's integration yet: share one in Notion, then come back here.</p>
      ) : (
        <>
          <label className="opens-on">
            <span>todos are kept in</span>
            <select value={state.chosen ?? ""} onChange={(event) => void choose(event.target.value || null)}>
              <option value="">no database</option>
              {state.databases.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.title}
                </option>
              ))}
            </select>
          </label>
          <p className="hint">Choosing one lets Kyuren read Notion, and write to that database alone.</p>
        </>
      )}
    </section>
  );
}
