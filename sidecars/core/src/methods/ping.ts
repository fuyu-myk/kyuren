const startedAt = performance.now();

export function ping() {
  return {
    name: "core",
    version: "0.0.0",
    uptimeMs: Math.round(performance.now() - startedAt),
  };
}
