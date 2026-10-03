import { cloudConfigured, nameFor, online } from "#model/providers.ts";
import { route, ROUTES } from "#model/route.ts";
import { preload } from "#model/warm.ts";
import type { Transport } from "#transport.ts";

/// Making the model resident before the first question. Loading one costs about fifteen seconds
/// and saturates the machine while it happens, which is long enough to stop audio starting.
export function modelHandlers(transport: Transport) {
  let warming: Promise<boolean> | null = null;

  return {
    "model.warm": async () => {
      const decision = route({
        sensitive: false,
        online: await online(),
        cloudConfigured: cloudConfigured(),
        // Matching what the spoken path asks for, so the model warmed is the model used.
        difficulty: "trivial",
      });

      if (!warming) {
        warming = preload(decision.route).then((loaded) => {
          transport.send({ event: "model.warm", data: { route: decision.route, loaded } });
          warming = null;
          return loaded;
        });
      }

      return { route: decision.route, warming: true };
    },

    /// The routes a turn may take and the model behind each, with whether the cloud can be
    /// reached now, so the window can offer a choice that is honest about what is there.
    "model.options": async () => {
      const reachable = cloudConfigured() && (await online());
      return {
        options: ROUTES.map((one) => ({
          route: one,
          model: nameFor(one),
          available: one !== "cloud" || reachable,
        })),
      };
    },
  };
}
