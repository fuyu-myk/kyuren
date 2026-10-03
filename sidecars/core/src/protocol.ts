export type Request = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

export type ErrorBody = {
  code: string;
  message: string;
};

export type Response =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: ErrorBody };

export type Event = {
  event: string;
  data?: unknown;
};

export type Outbound = Response | Event;

export const ErrorCode = {
  MethodNotFound: "method_not_found",
  InvalidParams: "invalid_params",
  Internal: "internal",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRequest(line: string): Request | { id: string | null; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { id: null, reason: "line is not valid JSON" };
  }
  if (!isRecord(parsed)) {
    return { id: null, reason: "message is not an object" };
  }

  const id = typeof parsed.id === "string" ? parsed.id : null;
  if (typeof parsed.method !== "string") {
    return { id, reason: "message has no method" };
  }
  if (id === null) {
    return { id: null, reason: "request has no string id" };
  }
  if (parsed.params !== undefined && !isRecord(parsed.params)) {
    return { id, reason: "params is not an object" };
  }

  return { id, method: parsed.method, params: parsed.params };
}

export function isRequest(value: Request | { id: string | null; reason: string }): value is Request {
  return "method" in value;
}

export function ok(id: string, result: unknown): Response {
  return { id, ok: true, result };
}

export function fail(id: string, code: string, message: string): Response {
  return { id, ok: false, error: { code, message } };
}
