import { artworkOf } from "#media/artwork.ts";

export function mediaHandlers() {
  return {
    /// The cover of what the island shows playing, or nothing when it cannot be found.
    "media.artwork": async (params: Record<string, unknown>) => {
      const player = typeof params.player === "string" ? params.player : "";
      const track = typeof params.track === "string" ? params.track : "";
      const art = await artworkOf(player, track).catch(() => undefined);
      return { art: art ?? null };
    },
  };
}
