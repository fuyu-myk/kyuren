import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/// Measures the routes a hard request can take, through the core's own provider code, against
/// proofs that a machine can check. Run from anywhere: `node tools/escalation/measure.ts`.
/// Results land in tools/escalation/results/, and the summary in docs/MEASUREMENTS.md is the
/// part that lasts.

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CORE = new URL("../../sidecars/core/src/", import.meta.url).href;
const KEYCHAIN_SERVICE = "dev.kyuren.assistant";
const TIMEOUT_MS = 240_000;
// `--budget N` gives every answer more room; a thinking model counts its thinking against it.
const MAX_TOKENS = process.argv.includes("--budget") ? Number(process.argv[process.argv.indexOf("--budget") + 1]) : 1500;

type Proof =
  | { type: "contains"; any: string[]; none?: string[]; line?: "first" }
  | { type: "code"; test: string }
  | { type: "schedule"; fixed: Array<[string, string]>; tasks: Record<string, number>; window: [string, string] };

type Task = { id: string; prompt: string; proof: Proof };

type Run = {
  route: string;
  model: string;
  task: string;
  passed: boolean;
  why: string;
  seconds: number;
  inputTokens?: number;
  outputTokens?: number;
  answer: string;
};

/// The key is fetched into this process and never written or printed by it.
function keyFromKeychain(): void {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const key = execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", "anthropic", "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch {
    // Without it the cloud route is simply reported as unavailable.
  }
}

function minutes(at: string): number {
  const [h, m] = at.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function checkSchedule(answer: string, proof: Extract<Proof, { type: "schedule" }>): string | undefined {
  const match = answer.match(/\[[\s\S]*\]/);
  if (!match) return "no JSON array in the answer";
  let items: Array<{ what: string; start: string; end: string }>;
  try {
    items = JSON.parse(match[0]);
  } catch {
    return "the array does not parse";
  }
  const [open, close] = proof.window.map(minutes);
  const spans = items.map((one) => ({ what: String(one.what ?? "").toLowerCase(), start: minutes(one.start), end: minutes(one.end) }));
  for (const [name, need] of Object.entries(proof.tasks)) {
    const found = spans.find((one) => one.what.includes(name));
    if (!found) return `task '${name}' is missing`;
    if (found.end - found.start < need) return `task '${name}' is shorter than ${need} minutes`;
    if (found.start < open || found.end > close) return `task '${name}' is outside the working window`;
    for (const [a, b] of proof.fixed) {
      if (found.start < minutes(b) && found.end > minutes(a)) return `task '${name}' overlaps a fixed block ${a} to ${b}`;
    }
  }
  const tasks = Object.keys(proof.tasks).map((name) => spans.find((one) => one.what.includes(name))!);
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      if (tasks[i]!.start < tasks[j]!.end && tasks[j]!.start < tasks[i]!.end) return "two tasks overlap";
    }
  }
  return undefined;
}

function checkCode(answer: string, proof: Extract<Proof, { type: "code" }>): string | undefined {
  const block = answer.match(/```(?:js|javascript)?\s*([\s\S]*?)```/);
  const code = block?.[1] ?? answer;
  const dir = mkdtempSync(join(tmpdir(), "kyuren-escalation-"));
  writeFileSync(join(dir, "answer.mjs"), code);
  writeFileSync(join(dir, "test.mjs"), proof.test);
  const ran = spawnSync("node", ["test.mjs"], { cwd: dir, timeout: 10_000, encoding: "utf8" });
  if (ran.status === 0) return undefined;
  return `the tests failed: ${(ran.stderr || ran.stdout || String(ran.signal)).trim().slice(0, 160)}`;
}

function check(answer: string, proof: Proof): string | undefined {
  if (proof.type === "contains") {
    // A task that asked for the answer alone is judged on its first line, so an explanation
    // that names the alternatives it rejected does not fail a right answer.
    const judged = proof.line === "first" ? (answer.split("\n").find((one) => one.trim() !== "") ?? "") : answer;
    if (!proof.any.some((one) => judged.includes(one))) return `none of ${JSON.stringify(proof.any)} in the answer`;
    const wrong = (proof.none ?? []).find((one) => new RegExp(`\\b${one}\\b`).test(judged));
    if (wrong) return `'${wrong}' in the answer`;
    return undefined;
  }
  if (proof.type === "schedule") return checkSchedule(answer, proof);
  return checkCode(answer, proof);
}

/// The last thing a thinking model says is the answer; what it said to itself before is not.
function answered(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

async function main(): Promise<void> {
  keyFromKeychain();
  // The core's own copy of the SDK, so the harness measures exactly what the application runs.
  const fromCore = createRequire(fileURLToPath(CORE + "index.ts"));
  const { generateText } = (await import(pathToFileURL(fromCore.resolve("ai")).href)) as typeof import("ai");
  const providers = await import(CORE + "model/providers.ts");
  const warm = await import(CORE + "model/warm.ts");

  const tasks = JSON.parse(readFileSync(join(HERE, "tasks.json"), "utf8")) as Task[];
  // `--only cloud` measures one route, for when one model changes and the others have not.
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : undefined;
  const routes: Array<{ route: "local-small" | "local-large" | "cloud"; model: string }> = [
    { route: "cloud" as const, model: providers.nameFor("cloud") },
    { route: "local-small" as const, model: providers.nameFor("local-small") },
    { route: "local-large" as const, model: providers.nameFor("local-large") },
  ].filter((one) => only === undefined || one.route === only);
  const cloudOk = providers.cloudConfigured();
  const runs: Run[] = [];
  const loads: Record<string, number> = {};

  for (const { route, model } of routes) {
    if (route === "cloud" && !cloudOk) {
      console.log("cloud: no key, skipped");
      continue;
    }
    if (route !== "cloud") {
      // Cold: the model is unloaded first, so the load is part of what the user would wait for.
      await fetch(`${providers.OLLAMA_NATIVE}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, keep_alive: 0, prompt: "" }),
      }).catch(() => undefined);
      const began = performance.now();
      await warm.preload(route);
      loads[route] = Math.round((performance.now() - began) / 100) / 10;
      console.log(`${route}: loaded ${model} in ${loads[route]} s`);
    }
    for (const task of tasks) {
      const began = performance.now();
      let text = "";
      let usage: { inputTokens?: number; outputTokens?: number } = {};
      let failure: string | undefined;
      try {
        const result = await generateText({
          model: providers.modelFor(route, "hard"),
          prompt: task.prompt,
          providerOptions: providers.optionsFor(route),
          maxOutputTokens: MAX_TOKENS,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        });
        text = answered(result.text);
        usage = { inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens };
      } catch (error) {
        failure = error instanceof Error ? error.message.slice(0, 120) : String(error);
      }
      const seconds = Math.round((performance.now() - began) / 100) / 10;
      const why = failure ? `no answer: ${failure}` : check(text, task.proof);
      runs.push({
        route, model, task: task.id, passed: why === undefined, why: why ?? "proved", seconds,
        ...usage, answer: text.slice(0, 600),
      });
      console.log(`${route.padEnd(11)} ${task.id.padEnd(11)} ${why === undefined ? "pass" : "FAIL"} ${seconds}s  ${why ?? ""}`);
    }
  }

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  writeFileSync(join(HERE, "results", `${stamp}.json`), JSON.stringify({ loads, runs }, null, 2));

  console.log("\nSUMMARY");
  for (const { route } of routes) {
    const mine = runs.filter((one) => one.route === route);
    if (mine.length === 0) continue;
    const passed = mine.filter((one) => one.passed).length;
    const mean = mine.reduce((total, one) => total + one.seconds, 0) / mine.length;
    const slowest = Math.max(...mine.map((one) => one.seconds));
    const out = mine.reduce((total, one) => total + (one.outputTokens ?? 0), 0);
    console.log(`${route.padEnd(11)} ${passed}/${mine.length} proved  mean ${mean.toFixed(1)}s  slowest ${slowest}s  load ${loads[route] ?? "-"}s  output tokens ${out}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
