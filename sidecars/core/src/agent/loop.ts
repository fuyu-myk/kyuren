import { stepCountIs, streamText, tool, type LanguageModelUsage, type ModelMessage } from "ai";
import type { z } from "zod";
import { invoke, type Ask, type Exposure, type Tool } from "#agent/tool.ts";
import { TurnFailed } from "#agent/failed.ts";
import { codeSchema, codeTool } from "#agent/code.ts";
import { routeHolding } from "#agent/holding.ts";
import { forgeSchema, forgeTool } from "#agent/forge.ts";
import { noteSchema, noteTool } from "#agent/note.ts";
import {
  authoringOffered,
  playbookSchema,
  playbooksSchema,
  playbooksTool,
  playbookTool,
  proposeSchema,
  proposeTool,
} from "#agent/playbook.ts";
import { projectSchema, projectTool } from "#agent/project.ts";
import { rememberSchema, rememberTool } from "#agent/remember.ts";
import { skillSchema, skillTool } from "#agent/skill.ts";
import { todaySchema, todayTool } from "#agent/today.ts";
import { webFetchSchema, webFetchTool, webSearchSchema, webSearchTool } from "#agent/web.ts";
import { sharedMemory } from "#memory/shared.ts";
import { BACK_DAYS, FORWARD_DAYS, SOURCES } from "#methods/brief.ts";
import { listDirectory, listSchema, readFile, readFileSchema, writeFile, writeFileSchema } from "#agent/tools.ts";
import { messagesFor } from "#agent/moment.ts";
import { difficultyOf } from "#model/difficulty.ts";
import { cloudConfigured, modelFor, nameFor, online, optionsFor } from "#model/providers.ts";
import type { Gate } from "#permission/gate.ts";
import { added, type Spent } from "#playbook/runlog.ts";
import type { Ran } from "#playbook/runner.ts";
import { home, sharedPlaybooks, sharedRuns } from "#playbook/shared.ts";
import { route, type Demand, type Route } from "#model/route.ts";
import { release } from "#model/warm.ts";

const MAX_STEPS = 8;

/// How many times a cloud request is tried again when the service is busy. The limit is in tokens
/// read per minute, and an agentic turn reads its whole context again at every step.
const CLOUD_RETRIES = 4;

/// How much a cloud step may say, thinking included. The provider's own default is a few
/// thousand tokens, which a plan thought through at length used up before the first tool call,
/// and the turn ended on a sentence of intent. A report is written in one step, as the argument
/// of one call, so the room has to hold a whole report and the thinking before it.
const CLOUD_ROOM = 32_000;

function withoutCache(message: ModelMessage): ModelMessage {
  const { anthropic, ...others } = message.providerOptions ?? {};
  const { cacheControl: _dropped, ...rest } = (anthropic ?? {}) as Record<string, unknown>;
  return { ...message, providerOptions: { ...others, anthropic: rest } } as ModelMessage;
}

/// A cache breakpoint on the latest message and nowhere else: the whole context before it is
/// then read from the cache at the next step, which is cheaper and mostly outside the limit.
/// Earlier marks are taken off first, since a step's messages carry forward and the service
/// allows only a few.
function cachedUpTo(messages: ModelMessage[]): ModelMessage[] {
  const plain = messages.map(withoutCache);
  const last = plain[plain.length - 1];
  if (!last) return plain;
  const marked = {
    ...last,
    providerOptions: { ...last.providerOptions, anthropic: { ...(last.providerOptions?.anthropic ?? {}), cacheControl: { type: "ephemeral" } } },
  } as ModelMessage;
  return [...plain.slice(0, -1), marked];
}

function said(trouble: unknown): string {
  return trouble instanceof Error ? trouble.message : String(trouble);
}

function spentOf(usage: LanguageModelUsage | undefined): Spent | undefined {
  return typeof usage?.inputTokens === "number"
    ? {
        input: usage.inputTokens,
        output: usage.outputTokens ?? 0,
        cacheRead: usage.inputTokenDetails?.cacheReadTokens ?? 0,
        cacheWrite: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
      }
    : undefined;
}

/// What the assistant can do, as the mind graph shows it. Names and descriptions only: a list of
/// what exists, not a way to reach any of it.
/// What Kyuren can do, and which part of the workspace each thing belongs to.
export const CAPABILITIES = [
  { name: "read_file", description: "Read a text file from disk.", pane: "development" },
  { name: "list_directory", description: "List the entries of a directory.", pane: "development" },
  { name: "write_file", description: "Write text to a file.", pane: "development" },
  { name: "add_to_notion", description: "Add one entry to a Notion database.", pane: "knowledge" },
  { name: "remember", description: "Search the user's own notes.", pane: "knowledge" },
  { name: "project", description: "Where a project stood when work stopped.", pane: "development" },
  { name: "code", description: "Send a coding session into a repository.", pane: "development" },
  { name: "forge", description: "Write down a new skill, inert until approved.", pane: "knowledge" },
  { name: "skill", description: "Use one of the approved skills.", pane: "knowledge" },
  { name: "today", description: "What the user's day holds.", pane: "comms" },
  { name: "playbook", description: "Run one of the approved playbooks.", pane: "knowledge" },
  { name: "playbooks", description: "Run several approved playbooks at once, each with its own log.", pane: "knowledge" },
  { name: "web_search", description: "Search the web through the local browser.", pane: "knowledge" },
  { name: "web_fetch", description: "Read a web page through the local browser.", pane: "knowledge" },
] as const;

function adapt<A>(
  subject: Tool<A>,
  schema: z.ZodType<A>,
  gate: Gate,
  ask: Ask,
  spoken: string[],
  watching: Watching,
  exposure: Exposure,
) {
  return tool({
    description: subject.description,
    inputSchema: schema,
    execute: async (args: A, options: { abortSignal?: AbortSignal }) => {
      const signal = options.abortSignal ?? new AbortController().signal;
      // Announced before it runs and again when it is done, so what is watching sees the waiting
      // rather than only the result.
      const action = subject.describe(args);
      const step = watching?.began(subject.name, action.target, action.effect);
      let asked = false;
      const asking: Ask = (about, why, stopped) => {
        asked = true;
        return ask(about, why, stopped);
      };
      const outcome = await invoke(subject, args, gate, asking, signal, exposure);
      watching?.ended(step ?? "", outcome.ok, !outcome.ok && outcome.refused, asked);
      if (outcome.ok) {
        const said = (outcome.value as { spoken?: unknown } | null)?.spoken;
        if (typeof said === "string" && said !== "") spoken.push(said);
        return outcome.value;
      }
      // A refusal is reported back to the model as a result, not thrown. The turn stays coherent
      // and the model can say what it could not do rather than failing opaquely.
      return { failed: true, refused: outcome.refused, reason: outcome.reason };
    },
  });
}

/// Told what a turn is doing while it does it, for the layer of the mind that is live.
export type Watching = {
  began: (tool: string, target: string, effect?: string) => string;
  ended: (step: string, ok: boolean, refused?: boolean, asked?: boolean) => void;
};

/// What a turn actually did, kept with the answer so that an answer can say how it was arrived at.
export type Called = {
  tool: string;
  target: string;
  effect?: string;
  ok?: boolean;
  /// True when the gate said no, as opposed to the tool failing on its own.
  refused?: boolean;
  /// True when the question was put, rather than the gate deciding from its policy, an earlier
  /// answer or a run's allowance.
  asked?: boolean;
};


/// What was already said in this session, so that resuming one is resuming a conversation rather
/// than starting a fresh one that happens to be filed next to it.
export type Said = {
  role: "user" | "assistant";
  text: string;
};

export type Run = {
  prompt: string;
  vault: string;
  history?: Said[];
  watching?: Watching;
  system?: string;
  sensitive?: boolean;
  difficulty?: Demand["difficulty"];
  /// A route the user chose for this turn, honoured where the routing drivers allow.
  preferred?: Route;
  gate: Gate;
  ask: Ask;
  signal?: AbortSignal;
  onText?: (chunk: string) => void;
  /// Only these tools, when given. A playbook names what it draws on and gets nothing else.
  tools?: string[];
  /// How many tool calls the turn may make. A chat turn gets a handful; a playbook run gets more,
  /// since searching, reading and writing is a dozen calls before anything is written.
  steps?: number;
  /// Told of every playbook run this turn starts, so a run that starts others can prove them.
  onRan?: (ran: Ran) => void;
  /// Whether what the turn is given already holds the user's notes: from earlier in its
  /// conversation, or from the turn that started the run it belongs to.
  exposed?: boolean;
  /// Whether what the turn finds goes on to a model on the cloud, as a run's findings go back to a
  /// turn on the cloud that started it, wherever the run itself is answered.
  cloudAbove?: boolean;
  /// How long the model may say nothing, while no tool is running, before the turn is given up.
  silence?: number;
};

/// A model that says nothing for this long, while no tool is running, has stalled: a local one
/// loading and reading a long context takes a minute or two before its first word. A tool running,
/// or a question waiting on the user, is not the model's silence, and may rightly take far longer.
const SILENCE = 5 * 60_000;

/// Whether a part of the stream is the model saying something, rather than only beginning to.
function spoke(chunk: { type: string; text?: unknown; delta?: unknown }): boolean {
  if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") return typeof chunk.text === "string" && chunk.text !== "";
  if (chunk.type === "tool-input-delta") return typeof chunk.delta === "string" && chunk.delta !== "";
  return chunk.type === "tool-call";
}

function waited(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${ms} ms`;
}

export type Transcript = {
  text: string;
  difficulty: string;
  /// What a tool said should be spoken, word for word. A report of facts is not improved by being
  /// retold, and a smaller model retelling it gets the facts wrong.
  spoken?: string;
  route: Route;
  model: string;
  reason: string;
  steps: number;
  /// Every tool the turn reached for, in the order it reached for them.
  called: Called[];
  elapsedMs: number;
  /// What the last step read and wrote, as the model reported it: the input is the context the
  /// answer was given in.
  usage?: { input: number; output: number };
  /// What the whole turn cost, every step together. A turn with tools reads its context again at
  /// every step, so this is many times the last step's figure.
  spent?: Spent;
  /// Whether the turn held the user's notes by its end, given them or reading them itself.
  exposed?: boolean;
};

export async function run(options: Run): Promise<Transcript> {
  // Judged rather than assumed. Every turn was being answered as though it were trivial, which is
  // right for a greeting and wrong for anything that needs working out.
  const difficulty = options.difficulty ?? (await difficultyOf(options.prompt));

  const demand = {
    sensitive: options.sensitive ?? false,
    online: await online(),
    cloudConfigured: cloudConfigured(),
    difficulty,
    preferred: options.preferred,
  };
  const decision = await routeHolding(route(demand), options.exposed === true, demand, options.ask, options.gate);

  const began = performance.now();
  const spoken: string[] = [];
  const exposure: Exposure = { held: options.exposed === true, cloud: decision.route === "cloud" || options.cloudAbove === true };

  // The model's silence ends the turn only while no tool is running, so it is watched with what runs.
  const silence = options.silence ?? SILENCE;
  const quiet = new AbortController();
  let working = 0;
  let hushed: ReturnType<typeof setTimeout> | undefined;
  const heard = () => clearTimeout(hushed);
  const listen = () => {
    heard();
    if (working === 0) hushed = setTimeout(() => quiet.abort(), silence);
  };

  // Whoever asked may also be watching; either way the turn keeps its own account of what it did.
  const called: Called[] = [];
  const where = new Map<string, number>();
  const watching: Watching = {
    began: (tool, target, effect) => {
      working += 1;
      heard();
      const step = options.watching?.began(tool, target, effect) ?? `step:${called.length}`;
      where.set(step, called.push({ tool, target, effect }) - 1);
      return step;
    },
    ended: (step, ok, refused, asked) => {
      working -= 1;
      listen();
      const at = where.get(step);
      if (at !== undefined) {
        called[at]!.ok = ok;
        called[at]!.refused = refused;
        called[at]!.asked = asked;
      }
      options.watching?.ended(step, ok, refused, asked);
    },
  };
  const performing = {
    perform: run,
    vault: options.vault,
    home: home(),
    books: sharedPlaybooks(),
    runs: sharedRuns(),
    gate: options.gate,
    ask: options.ask,
    watching: options.watching,
    exposed: () => exposure.held,
    cloud: () => exposure.cloud === true,
    // A run that read the user's notes hands back what it found, so this turn holds them too.
    onRan: (ran: Ran) => {
      if (ran.transcript.exposed) exposure.held = true;
      options.onRan?.(ran);
    },
  };
  const everything = {
    read_file: adapt(readFile, readFileSchema, options.gate, options.ask, spoken, watching, exposure),
      list_directory: adapt(listDirectory, listSchema, options.gate, options.ask, spoken, watching, exposure),
      write_file: adapt(writeFile, writeFileSchema, options.gate, options.ask, spoken, watching, exposure),
      add_to_notion: adapt(noteTool, noteSchema, options.gate, options.ask, spoken, watching, exposure),
      project: adapt(projectTool(), projectSchema, options.gate, options.ask, spoken, watching, exposure),
      code: adapt(codeTool(), codeSchema, options.gate, options.ask, spoken, watching, exposure),
      forge: adapt(forgeTool(), forgeSchema, options.gate, options.ask, spoken, watching, exposure),
      skill: adapt(skillTool(), skillSchema, options.gate, options.ask, spoken, watching, exposure),
      remember: adapt(
        rememberTool(sharedMemory()),
        rememberSchema,
        options.gate,
        options.ask,
        spoken,
        watching,
        exposure,
      ),
      today: adapt(
        todayTool(SOURCES, BACK_DAYS, FORWARD_DAYS, options.gate, options.ask, options.vault),
        todaySchema,
        options.gate,
        options.ask,
        spoken,
        watching,
        exposure,
      ),
    web_search: adapt(webSearchTool(), webSearchSchema, options.gate, options.ask, spoken, watching, exposure),
    web_fetch: adapt(webFetchTool(), webFetchSchema, options.gate, options.ask, spoken, watching, exposure),
    playbook: adapt(playbookTool(performing), playbookSchema, options.gate, options.ask, spoken, watching, exposure),
    playbooks: adapt(playbooksTool(performing), playbooksSchema, options.gate, options.ask, spoken, watching, exposure),
    // Authoring is for the frontier model only. The local models run playbooks and never write
    // them, so the tool does not exist on their routes.
    ...(authoringOffered(decision.route)
      ? { playbook_propose: adapt(proposeTool(), proposeSchema, options.gate, options.ask, spoken, watching, exposure) }
      : {}),
  };
  const offered = options.tools
    ? Object.fromEntries(Object.entries(everything).filter(([name]) => options.tools?.includes(name)))
    : everything;

  // A stream ends quietly on an error unless told to say so. Quiet, a turn cut off by a rate
  // limit looks like a model that chose to stop, and a run's proof then fails for the wrong reason.
  let trouble: unknown;
  // Counted as each step ends, so a turn that fails part way can still say what it cost.
  let finished: Spent | undefined;
  const result = streamText({
    model: modelFor(decision.route, difficulty),
    system: options.system,
    messages: messagesFor(options.history ?? [], options.prompt),
    stopWhen: stepCountIs(options.steps ?? MAX_STEPS),
    abortSignal: options.signal ? AbortSignal.any([options.signal, quiet.signal]) : quiet.signal,
    onStepStart: listen,
    onChunk: ({ chunk }) => {
      if (spoke(chunk)) listen();
    },
    tools: offered,
    onError: ({ error }) => {
      trouble = error;
    },
    onStepEnd: (step) => {
      finished = added(finished, spentOf(step.usage));
    },
    ...(decision.route === "cloud"
      ? {
          maxRetries: CLOUD_RETRIES,
          maxOutputTokens: CLOUD_ROOM,
          providerOptions: optionsFor(decision.route),
          prepareStep: ({ messages }: { messages: ModelMessage[] }) => ({ messages: cachedUpTo(messages) }),
        }
      : {}),
  });

  try {
    for await (const chunk of result.textStream) {
      options.onText?.(chunk);
    }
    // Stopped, or gone quiet, once a step has finished, the stream ends as though it were done.
    if (options.signal?.aborted || quiet.signal.aborted) throw new Error("cut short");
    if (trouble !== undefined) throw new Error(`the model stopped answering: ${said(trouble)}`);
    // A turn cut off for length is not an answer, and a run that ends on one has done nothing it
    // was asked to do while looking as though it chose to stop.
    const finish = await result.finishReason;
    if (finish === "length") throw new Error("the model ran out of room before it finished");
    // A refusal the fallback refused as well. Said, so it is not mistaken for a model that chose
    // to say nothing.
    if (finish === "content-filter") throw new Error("the model declined to answer this, and so did the model it fell back to");
  } catch (failure) {
    const reason = options.signal?.aborted
      ? "stopped before it finished"
      : quiet.signal.aborted
        ? `the model said nothing for ${waited(silence)}`
        : said(failure);
    throw new TurnFailed(reason, { called, route: decision.route, model: nameFor(decision.route), exposed: exposure.held, spent: finished });
  } finally {
    heard();
  }

  const steps = await result.steps;
  // The SDK's usage is every step summed, which is what the turn cost. What the model read in its
  // last step is the context it answered in, and that is the last step's own figure.
  const total = await result.usage;
  const usage = steps.at(-1)?.usage;
  // The large model is let go soon after it has answered, so the memory it held goes back to
  // what listening needs. Not awaited: the answer is not made to wait for housekeeping.
  if (decision.route === "local-large") void release(decision.route);
  return {
    text: (await result.text).trim(),
    usage: typeof usage?.inputTokens === "number"
      ? { input: usage.inputTokens, output: usage.outputTokens ?? 0 }
      : undefined,
    spent: spentOf(total),
    difficulty,
    spoken: spoken.length > 0 ? spoken.join(" ") : undefined,
    route: decision.route,
    model: nameFor(decision.route),
    reason: decision.reason,
    steps: steps.length,
    called,
    elapsedMs: Math.round(performance.now() - began),
    exposed: exposure.held,
  };
}
