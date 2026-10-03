/// Where a track's artwork is found without asking the player for it: Spotify's public oEmbed by
/// track id, and Apple's store lookup by store id. Only the services' own image hosts are fetched
/// from, whatever a reply points at, and the image comes back in hand, since the island's pages
/// load nothing from the web themselves.

const PATIENCE = 8_000;
/// More than a cover needs; anything larger is not one.
const BIGGEST = 1 << 20;

export function lookupUrl(player: string, track: string): string | undefined {
  if (player === "spotify" && /^spotify:track:[A-Za-z0-9]+$/.test(track)) {
    return `https://open.spotify.com/oembed?url=${encodeURIComponent(track)}`;
  }
  if (player === "music" && /^\d+$/.test(track)) return `https://itunes.apple.com/lookup?id=${track}`;
  return undefined;
}

/// Each service's image domains: Spotify serves covers from two.
const IMAGES: Record<string, string[]> = {
  spotify: ["scdn.co", "spotifycdn.com"],
  music: ["mzstatic.com"],
};

function trusted(url: string, player: string): boolean {
  try {
    const parsed = new URL(url);
    const hosts = IMAGES[player] ?? [];
    return parsed.protocol === "https:" && hosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

export function imageUrl(player: string, reply: unknown): string | undefined {
  if (player === "spotify") {
    const url = (reply as { thumbnail_url?: unknown } | null)?.thumbnail_url;
    return typeof url === "string" && trusted(url, "spotify") ? url : undefined;
  }
  if (player === "music") {
    const first = (reply as { results?: Array<{ artworkUrl100?: unknown }> } | null)?.results?.[0]?.artworkUrl100;
    if (typeof first !== "string") return undefined;
    const larger = first.replace(/\/\d+x\d+bb\./, "/300x300bb.");
    return trusted(larger, "music") ? larger : undefined;
  }
  return undefined;
}

/// Read to the end only while it stays a cover's size; anything larger is let go part way.
async function bounded(reply: Response): Promise<Buffer | undefined> {
  const reader = reply.body?.getReader();
  if (!reader) return undefined;
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BIGGEST) {
      await reader.cancel();
      return undefined;
    }
    parts.push(value);
  }
  return size === 0 ? undefined : Buffer.concat(parts);
}

export async function artworkOf(player: string, track: string, get: typeof fetch = fetch): Promise<string | undefined> {
  const lookup = lookupUrl(player, track);
  if (!lookup) return undefined;
  // Redirects are not followed: the hosts are checked by name, and a trusted host could otherwise
  // pass the request on to any other.
  const asked: RequestInit = { redirect: "manual" };
  const reply = await get(lookup, { ...asked, signal: AbortSignal.timeout(PATIENCE) });
  if (!reply.ok) return undefined;
  const image = imageUrl(player, await reply.json().catch(() => null));
  if (!image) return undefined;
  const picture = await get(image, { ...asked, signal: AbortSignal.timeout(PATIENCE) });
  const kind = (picture.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  if (!picture.ok || !/^image\/(jpeg|png|webp)$/.test(kind)) return undefined;
  const bytes = await bounded(picture);
  return bytes ? `data:${kind};base64,${bytes.toString("base64")}` : undefined;
}
