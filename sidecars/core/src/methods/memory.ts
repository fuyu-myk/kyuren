import { homedir } from "node:os";
import { CAPABILITIES } from "#agent/loop.ts";
import { sharedPlaybooks } from "#playbook/shared.ts";
import { sharedSkills } from "#skill/shared.ts";
import { ownVault, sharedMemory, vaultPaths, vaults } from "#memory/shared.ts";
import { addVault, DEFAULT_MODE, MODES, removeVault, setMode, type Mode } from "#memory/vaults.ts";
import { databases, remember as rememberDatabases, setMode as setDatabaseMode } from "#connect/notion/places.ts";
import { databasesAvailable } from "#connect/notion/write.ts";
import { watchVault } from "#memory/watch.ts";
import type { Transport } from "#transport.ts";

/// The index lives beside the vault but is not part of it: a folder an editor ignores, holding
/// nothing that cannot be rebuilt from the notes themselves.
export function memoryHandlers(transport: Transport) {
  const memory = sharedMemory();

  // Built once at startup, then kept level by watching. Notes edited in another editor, or by
  // hand, count exactly as much as notes Kyuren wrote.
  void memory.learnEverything().then(
    (built) => transport.send({ event: "memory.indexed", data: built }),
    (failure: unknown) => transport.send({
      event: "memory.failed",
      data: { reason: failure instanceof Error ? failure.message : String(failure) },
    }),
  );

  const watching = new Map<string, ReturnType<typeof watchVault>>();

  /// Every connected vault is watched, including ones connected later. A folder someone edits in
  /// Obsidian has to count the same as one Kyuren wrote.
  function watchAll(): void {
    const wanted = new Set(vaultPaths());
    for (const [where, watcher] of watching) {
      if (!wanted.has(where)) {
        watcher.stop();
        watching.delete(where);
      }
    }
    for (const where of wanted) {
      if (watching.has(where)) continue;
      watching.set(where, watchVault(where, (files) => {
        void Promise.all(files.map((file) => memory.learn(file))).then(
          (counts) => transport.send({
            event: "memory.changed",
            data: { files, embedded: counts.reduce((total, one) => total + one, 0) },
          }),
          () => {},
        );
      }));
    }
  }

  watchAll();

  return {
    "memory.recall": async (params: Record<string, unknown>) => {
      const question = params.question;
      if (typeof question !== "string" || question.trim() === "") {
        throw new Error("memory.recall needs a question");
      }
      const most = typeof params.most === "number" ? Math.min(20, Math.max(1, params.most)) : 5;

      const began = performance.now();
      const found = await memory.recall(question.trim(), most);
      return { found, tookMs: Math.round(performance.now() - began) };
    },

    "memory.entities": async (params: Record<string, unknown>) => {
      const all = await memory.entities();
      const most = typeof params.most === "number" ? Math.max(1, params.most) : 20;
      return { entities: all.slice(0, most), total: all.length };
    },

    "memory.vaults": async () => ({ vaults: vaults(), own: ownVault, home: homedir() }),

    "memory.mode": async (params: Record<string, unknown>) => {
      const path = params.path;
      const mode = MODES.find((one) => one === params.mode);
      if (typeof path !== "string" || path.trim() === "") {
        throw new Error("memory.mode needs a folder");
      }
      if (!mode) throw new Error(`mode must be one of ${MODES.join(", ")}`);
      return { vaults: setMode(path.trim(), mode) };
    },

    "memory.connect": async (params: Record<string, unknown>) => {
      const path = params.path;
      if (typeof path !== "string" || path.trim() === "") {
        throw new Error("memory.connect needs a folder");
      }
      // Read only unless asked for otherwise. Connecting someone's notes is not handing them over.
      const mode = (MODES.find((one) => one === params.mode) ?? DEFAULT_MODE) as Mode;
      const all = addVault(path.trim(), mode);
      watchAll();
      const built = await memory.learnEverything();
      return { vaults: all, built };
    },

    "memory.disconnect": async (params: Record<string, unknown>) => {
      const path = params.path;
      if (typeof path !== "string" || path.trim() === "") {
        throw new Error("memory.disconnect needs a folder");
      }
      const all = removeVault(path.trim());
      watchAll();
      // What the folder held is dropped, but nothing in it is touched: it was only ever read.
      const built = await memory.relearn();
      return { vaults: all, built };
    },

    /// What Kyuren can see in Notion, and what it may do to each of them. Finding a database again
    /// never re-opens one that was closed.
    "notion.databases": async () => {
      const found = await databasesAvailable().catch(() => []);
      return { databases: rememberDatabases(found) };
    },

    "notion.mode": async (params: Record<string, unknown>) => {
      const id = params.id;
      const mode = MODES.find((one) => one === params.mode);
      if (typeof id !== "string" || id.trim() === "") throw new Error("notion.mode needs a database");
      if (!mode) throw new Error(`mode must be one of ${MODES.join(", ")}`);
      return { databases: setDatabaseMode(id.trim(), mode) };
    },

    "notion.known": async () => ({ databases: databases() }),

    "memory.graph": async () => memory.graph(ownVault),

    /// What the assistant can do, as nodes. Separate from the memory layer because it is about
    /// Kyuren rather than about the user, and carried as nodes because both the mind and the panes
    /// want the same list.
    "capabilities.known": async () => ({
      nodes: [
        ...CAPABILITIES.map((one) => ({
          id: `tool:${one.name}`,
          label: one.name,
          layer: "capability" as const,
          kind: "tool" as const,
          weight: 1,
          description: one.description,
          pane: one.pane,
          state: "native" as const,
        })),
        // An approved playbook is something Kyuren can do by the book, and a pending one is
        // something it is about to be able to do, so both are shown.
        ...sharedPlaybooks().list().map((one) => ({
          id: `playbook:${one.name}`,
          label: one.name,
          layer: "capability" as const,
          kind: "tool" as const,
          weight: 2,
          description: (sharedPlaybooks().read(one.name) ?? sharedPlaybooks().readPending(one.name))?.when ?? "",
          pane: "knowledge" as const,
          state: one.approved ? ("approved" as const) : ("pending" as const),
        })),
        // A forged skill appears here the moment it is drafted, so the graph shows the assistant
        // growing rather than only showing what it was given.
        ...sharedSkills().list().map((one) => ({
          id: `skill:${one.id}`,
          label: one.name,
          layer: "capability" as const,
          kind: "tool" as const,
          weight: 1,
          description: one.trouble ? `${one.about} (${one.trouble})` : one.about,
          pane: "knowledge" as const,
          state: one.state,
        })),
      ],
    }),

    "memory.rebuild": async () => memory.learnEverything(),

    "memory.state": async () => memory.counts(),
  };
}
