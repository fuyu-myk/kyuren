import assert from "node:assert/strict";
import { test } from "node:test";
import { artworkOf, imageUrl, lookupUrl } from "#media/artwork.ts";

test("a track is looked up only by an id that is one", () => {
  assert.equal(lookupUrl("spotify", "spotify:track:4uLU6hMCjMI75M1A2tKUQC"), "https://open.spotify.com/oembed?url=spotify%3Atrack%3A4uLU6hMCjMI75M1A2tKUQC");
  assert.equal(lookupUrl("music", "1440857781"), "https://itunes.apple.com/lookup?id=1440857781");
  assert.equal(lookupUrl("spotify", "spotify:track:x/../../etc"), undefined);
  assert.equal(lookupUrl("music", "12; rm"), undefined);
  assert.equal(lookupUrl("winamp", "1"), undefined);
});

test("an image is taken only from the service's own image host, whatever a reply points at", () => {
  assert.equal(imageUrl("spotify", { thumbnail_url: "https://i.scdn.co/image/ab67" }), "https://i.scdn.co/image/ab67");
  assert.equal(imageUrl("spotify", { thumbnail_url: "https://image-cdn-fa.spotifycdn.com/image/ab67" }), "https://image-cdn-fa.spotifycdn.com/image/ab67");
  assert.equal(imageUrl("spotify", { thumbnail_url: "https://evil.example/i.scdn.co/a" }), undefined);
  assert.equal(imageUrl("spotify", { thumbnail_url: "https://notspotifycdn.com/a" }), undefined, "a name that merely ends alike is not the host");
  assert.equal(imageUrl("spotify", { thumbnail_url: "http://i.scdn.co/image/ab67" }), undefined, "and only over https");
  assert.equal(
    imageUrl("music", { results: [{ artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg" }] }),
    "https://is1-ssl.mzstatic.com/image/thumb/a/300x300bb.jpg",
    "and asked for larger than the lookup's thumbnail",
  );
  assert.equal(imageUrl("music", { results: [] }), undefined);
});

test("artwork comes back as an image in hand, or not at all", async () => {
  const replies: Array<[string, Response]> = [
    ["oembed", new Response(JSON.stringify({ thumbnail_url: "https://i.scdn.co/image/x" }), { headers: { "content-type": "application/json" } })],
    ["image", new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } })],
  ];
  const asked: string[] = [];
  const fake = (async (url: string) => {
    asked.push(url);
    return replies.shift()![1];
  }) as unknown as typeof fetch;
  assert.equal(await artworkOf("spotify", "spotify:track:abc", fake), "data:image/jpeg;base64,AQID");
  assert.deepEqual(asked, ["https://open.spotify.com/oembed?url=spotify%3Atrack%3Aabc", "https://i.scdn.co/image/x"]);
  const notImage = (async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  assert.equal(await artworkOf("spotify", "spotify:track:abc", notImage), undefined);
});

test("a redirect is not followed, and an image too large is let go while it is read", async () => {
  const asked: Array<RequestInit | undefined> = [];
  const redirecting = (async (_url: string, init?: RequestInit) => {
    asked.push(init);
    return new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } });
  }) as unknown as typeof fetch;
  assert.equal(await artworkOf("spotify", "spotify:track:abc", redirecting), undefined);
  assert.equal(asked[0]?.redirect, "manual", "a trusted host cannot pass the request on");

  let sent = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 64 * 1024;
      controller.enqueue(new Uint8Array(64 * 1024));
    },
  });
  const replies = [
    new Response(JSON.stringify({ thumbnail_url: "https://i.scdn.co/image/x" })),
    new Response(endless, { headers: { "content-type": "image/jpeg" } }),
  ];
  const huge = (async () => replies.shift()!) as unknown as typeof fetch;
  assert.equal(await artworkOf("spotify", "spotify:track:abc", huge), undefined);
  assert.ok(sent < 4 * 1024 * 1024, `stopped reading at ${sent} bytes`);
});
