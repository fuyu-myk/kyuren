import { relative } from "node:path";

const LINE = 140;

/// Cut between characters, since half of one is not text: the host refuses a message holding it.
export function oneLine(text: string, most = LINE): string {
  const line = text.replace(/\s+/g, " ").trim();
  const characters = Array.from(line);
  return characters.length > most ? `${characters.slice(0, most - 1).join("")}…` : line;
}

export function fields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function text(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

export function record(line: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function placed(path: string, base: string | null): string {
  if (!base || !path) return path;
  const inside = relative(base, path);
  return inside && !inside.startsWith("..") && !inside.startsWith("/") ? inside : path;
}

export function said(name: string, input: Record<string, unknown>, base: string | null): { verb: string; target: string } {
  switch (name) {
    case "Bash":
      return { verb: "run", target: oneLine(text(input, "command")) };
    case "Edit":
    case "MultiEdit":
      return { verb: "edit", target: placed(text(input, "file_path"), base) };
    case "Write":
      return { verb: "write", target: placed(text(input, "file_path"), base) };
    case "NotebookEdit":
      return { verb: "edit", target: placed(text(input, "notebook_path"), base) };
    case "Read":
      return { verb: "read", target: placed(text(input, "file_path"), base) };
    case "Grep":
      return { verb: "search for", target: oneLine(text(input, "pattern")) };
    case "Glob":
      return { verb: "find", target: oneLine(text(input, "pattern")) };
    case "WebFetch":
      return { verb: "fetch", target: text(input, "url") };
    case "WebSearch":
      return { verb: "search the web for", target: oneLine(text(input, "query")) };
    case "Task":
    case "Agent":
      return { verb: "hand to an agent", target: oneLine(text(input, "description")) };
    case "TodoWrite":
      return { verb: "update", target: "its plan" };
    default: {
      const mcp = name.startsWith("mcp__") ? name.slice(5).split("__") : null;
      return mcp ? { verb: "use", target: `${mcp[0] ?? ""}: ${(mcp[1] ?? "").replace(/_/g, " ")}` } : { verb: "use", target: name };
    }
  }
}
