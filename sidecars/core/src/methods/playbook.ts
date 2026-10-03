import { run, type Watching } from "#agent/loop.ts";
import type { Ask } from "#agent/tool.ts";
import type { Starting } from "#ambient/schedule.ts";
import type { Gate } from "#permission/gate.ts";
import { inputsFor, inputsFrom } from "#playbook/invoke.ts";
import { performPlaybook, wordsFor } from "#playbook/perform.ts";
import { repairPlaybook } from "#playbook/repair.ts";
import { runPlaybook } from "#playbook/runner.ts";
import type { Playbook } from "#playbook/shape.ts";
import { home, sharedPlaybooks, sharedRuns } from "#playbook/shared.ts";
import { sharedSessions } from "#session/shared.ts";

function nameIn(params: Record<string, unknown>): string {
  const name = params.name;
  if (typeof name !== "string" || name.trim() === "") throw new Error("that needs a playbook");
  return name.trim();
}

/// A playbook as written, or nothing for one that does not read as a playbook: the list does not
/// hang on every file in it being well formed, and opening the one that is not says what is wrong.
function readable(read: () => Playbook | undefined): Playbook | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function inputsIn(params: Record<string, unknown>): Record<string, string> {
  const given = params.inputs;
  if (!given || typeof given !== "object") return {};
  return Object.fromEntries(
    Object.entries(given as Record<string, unknown>).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
  );
}

/// What Kyuren knows how to do by the book, and what standing each book has. Approving lives
/// here and nowhere the model can reach: approving a playbook is also allowing it to run.
export function playbookHandlers(gate: Gate, ask: Ask, vault: string, watch?: () => Watching) {
  const books = sharedPlaybooks();
  const runs = sharedRuns();

  return {
    "playbook.list": async () => ({
      playbooks: books.list().map((one) => {
        const book = readable(() => books.read(one.name) ?? books.readPending(one.name));
        return { ...one, when: book?.when ?? "", inputs: book?.inputs ?? [], recent: runs.recent(one.name, 5) };
      }),
    }),

    "playbook.read": async (params: Record<string, unknown>) => {
      const name = nameIn(params);
      return {
        name,
        approved: books.read(name),
        pending: books.readPending(name),
        diff: books.diff(name),
      };
    },

    "playbook.approve": async (params: Record<string, unknown>) => {
      const book = books.approve(nameIn(params), "user");
      gate.remember({ tool: "playbook", effect: "execute", target: book.name }, "allow");
      return { approved: book.name, version: book.version };
    },

    "playbook.reject": async (params: Record<string, unknown>) => {
      books.reject(nameIn(params));
      return { rejected: true };
    },

    "playbook.runs": async (params: Record<string, unknown>) => ({
      runs: runs.recent(nameIn(params), 20),
    }),

    "playbook.repair": async (params: Record<string, unknown>) => {
      // Asking for a repair is the permission to propose one, for as long as the repair runs;
      // the text still waits for approval. Held for the run rather than remembered, since a
      // remembered answer now outlives the process and this one should not.
      const withdraw = gate.allow("playbook_propose", "write");
      try {
        return await repairPlaybook({
          books,
          log: runs,
          name: nameIn(params),
          run: typeof params.run === "string" ? params.run : undefined,
          vault,
          gate,
          ask,
          perform: run,
        });
      } finally {
        withdraw();
      }
    },

    /// A slash command: the playbook by name and the words after it. Kept as a conversation in
    /// the pane it was typed in, so a page's past is its own and a run can be read back later.
    "playbook.invoke": async (params: Record<string, unknown>) => {
      const name = nameIn(params);
      const book = books.read(name);
      if (!book) throw new Error(`there is no approved playbook named ${name}`);
      const text = typeof params.text === "string" ? params.text : "";
      const inputs = inputsFrom(book, text);
      return performPlaybook(
        { books, runs, sessions: sharedSessions(), gate, ask, vault, home: home(), perform: run, watching: watch?.() },
        { name, inputs, saying: `/${name} ${text}`.trim(), pane: params.pane },
      );
    },

    "playbook.run": async (params: Record<string, unknown>) => {
      const ran = await runPlaybook({
        books,
        log: runs,
        name: nameIn(params),
        inputs: inputsIn(params),
        vault,
        home: home(),
        gate,
        ask,
        perform: run,
      });
      return { outcome: ran.run.outcome, proof: ran.run.proof, log: ran.path, said: ran.transcript.text };
    },
  };
}


/// Runs a playbook for a schedule, as the conversation a command would have started. Nobody is at
/// the keyboard, so a question the run would have asked is refused, and the refusal is in the
/// run's log rather than a prompt nobody answers.
export function scheduledStarter(gate: Gate, vault: string, watch?: () => Watching): Starting {
  const books = sharedPlaybooks();
  const runs = sharedRuns();
  return async (schedule) => {
    const book = books.read(schedule.playbook);
    if (!book) return { ok: false, why: `there is no approved playbook named ${schedule.playbook}` };
    const inputs = inputsFor(book, schedule.inputs);
    const first = book.inputs[0];
    const done = await performPlaybook(
      { books, runs, sessions: sharedSessions(), gate, ask: async () => "deny", vault, home: home(), perform: run, watching: watch?.() },
      { name: book.name, inputs, saying: `/${book.name} ${first ? inputs[first.name] ?? "" : ""}`.trim(), pane: schedule.pane },
    );
    return { ok: done.outcome === "done", why: wordsFor(done.outcome, done.proof) };
  };
}
