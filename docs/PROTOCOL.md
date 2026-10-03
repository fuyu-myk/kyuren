# Sidecar protocol

One JSON object per line, UTF-8, terminated by a single line feed. The Rust core is the host. The
perception sidecar and the cognition sidecar are both peers speaking this same protocol, so the
host supervises them with one implementation.

## Envelope

Three message shapes, discriminated by which key is present.

```
Request   host to sidecar     { "id": string, "method": string, "params"?: object }
Response  sidecar to host     { "id": string, "ok": true,  "result": unknown }
                              { "id": string, "ok": false, "error": { "code": string, "message": string } }
Event     sidecar to host     { "event": string, "data"?: unknown }
```

A message carrying `method` is a request. A message carrying `event` is an event. A message
carrying `id` and `ok` is a response. Any other shape is malformed.

## Rules

1. **Standard output carries protocol only.** Diagnostics go to standard error. A stray print to
   standard output corrupts the stream, so sidecars must not write to it by any path other than the
   transport.
2. **Malformed input never crashes a sidecar.** If an identifier can be recovered from the line, the
   sidecar answers with an error response. If it cannot, the sidecar emits a `sidecar.malformed`
   event and discards the line.
3. **Unknown methods answer, they do not hang.** Code `method_not_found`.
4. **Closing standard input terminates the sidecar.** The host quitting must not leave orphans.
5. **Requests may complete out of order.** Correlation is by identifier, never by arrival order.
6. **Every request receives exactly one response.** A handler that throws produces an error response
   rather than silence.

## Error codes

| Code | Meaning |
| --- | --- |
| `method_not_found` | No handler registered for the requested method. |
| `invalid_params` | The handler rejected the parameters. |
| `internal` | The handler threw. The message carries the reason. |

## Methods

### `ping`

Params: none. Result:

```json
{ "name": "core", "version": "0.0.0", "uptimeMs": 1234 }
```

Answers the liveness and identity question in one call. The host uses it to confirm a sidecar came
up before declaring the application ready.

### `secret.set`

Params: `{ "name": string, "secret": string }`. Result: `{ "connected": string[] }`.

The host reads credentials from the system keychain and hands them over on start and whenever one
changes. An empty secret forgets it. The sidecar holds them in memory only, so nothing outlives the
process.

### `secret.store`

Event, sidecar to host: `{ "name": string, "secret": string }`.

The reverse direction, for a credential a sidecar has just obtained rather than been given. The
host writes it to the keychain and hands it back through `secret.set`. This event is never written
to the event log.

### `oauth.connect`

Params: `{ "service": "google" | "microsoft", "clientId": string, "clientSecret"?: string }`.
Result: `{ "url": string }`.

Opens a listener on a loopback address and returns the consent address for the host to open. The
address is returned immediately; the grant arrives later as `secret.store` followed by an
`oauth.connected` event, or as `oauth.failed` carrying a service and a reason. A client secret is
required only by services that issue one.

### `brief.today`

Params: none. Result:

```json
{
  "facts": "Today is Tuesday 15 September...",
  "read": ["notion"],
  "refused": [],
  "unavailable": ["gmail"],
  "failed": [{ "source": "apple_calendar", "reason": "calendar access was not granted" }],
  "counts": { "overdue": 0, "today": 0, "soon": 1 }
}
```

Reads every connected source for the span around today. Each source is a separate gated action, so
a `permission.request` event may arrive per source before the result. A source without a credential
is unavailable rather than failed, and neither stops the others.

