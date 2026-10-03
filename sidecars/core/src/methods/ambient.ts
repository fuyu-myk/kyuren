import type { Scheduler } from "#ambient/schedule.ts";
import type { Ambient } from "#ambient/watch.ts";

export function ambientHandlers(ambient: Ambient, scheduler: Scheduler) {
  return {
    "ambient.state": async () => ({ ...ambient.state(), schedules: scheduler.state() }),
    "ambient.look": async () => ambient.look(),
    "ambient.recent": async (params: Record<string, unknown>) => {
      const limit = typeof params.limit === "number" && params.limit > 0 ? Math.min(200, params.limit) : 20;
      return ambient.recent(limit);
    },
  };
}
