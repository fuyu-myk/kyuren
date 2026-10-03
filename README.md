# Kyuren

A personal assistant for one person on one Mac. Summoned by a global hotkey, by its name, or by
hovering the notch, it takes requests by voice or text, does real things with the user's own
accounts and files, and answers by voice and through an island that grows out of the notch. Its
memory is plain markdown the user can read and edit, and its memory, live reasoning and
capabilities can be explored as one graph.

It is a personal project built for macOS 26 on Apple Silicon. It is not a hosted service: there
are no accounts, nothing syncs anywhere, and all state stays on the machine.

## What it does

- **Voice and text.** A global hotkey, or "Hey Kyuren" when the wake word is switched on, starts
  a conversation. Speech is heard, transcribed and spoken on the device.
- **The island.** A panel at the notch that peeks on hover and opens into pages: the conversation,
  a glance of switchable widgets (system load, network, a pomodoro, what Spotify or Music is
  playing), shortcuts that run playbooks, a shelf for files carried somewhere, questions waiting
  on the user, work in progress, coding agents, and notices.
- **Coding agents.** Every Claude Code session on the machine, what each is doing step by step,
  the commands it ran with their output, the changes it made, how its tests went, and a glance out
  of the notch when one finishes. With the user's consent, Claude Code's permission prompts can be
  answered from the island.
- **Memory.** Markdown notes in vaults the user connects, indexed locally for retrieval, with
  per-folder rules for what may be written where.
- **Playbooks.** One written procedure per recurring task, each with what done looks like, run on
  request or on a schedule, changed only with the user's approval.
- **Routing.** Requests go to a local model or to the cloud by sensitivity, availability,
  capability and cost. What is marked private stays on the machine, and your notes reach the cloud
  model only when you say yes.

The full design, including what it deliberately does not do, is in
[.claude/KYUREN.md](.claude/KYUREN.md).

## How it is built

Three processes, speaking newline-delimited JSON over stdio ([docs/PROTOCOL.md](docs/PROTOCOL.md)):

| Part | Where | What |
| --- | --- | --- |
| Host and windows | `apps/desktop` | Tauri v2 in Rust, with React and TypeScript windows: the main window, the island, the mind graph. |
| Perception | `sidecars/perception`, `sidecars/apple` | Swift: microphone, echo cancellation, voice activity, speech to text and back, the wake word, screen, hand pose, PDF text. |
| Cognition | `sidecars/core` | TypeScript on Node: routing, the agent loop, tools, permissions, memory, sessions, playbooks, the coding agent watch. |
| Hook relay | `sidecars/hook` | A small Rust program Claude Code runs to bring a permission prompt to the island. |

## Requirements

- macOS 26 on Apple Silicon.
- Xcode command line tools with Swift 6, and Rust 1.95 or newer.
- Node 24 or newer and pnpm 11 (`corepack enable` provides it).
- [Ollama](https://ollama.com) for the local models, with `qwen3.5:2b`, `qwen3.5:9b` and
  `nomic-embed-text` pulled. Without it, local routing and memory search are unavailable.
- Optionally, an Anthropic API key for the cloud route, entered in Kyuren's settings and kept in
  the macOS Keychain.

## Getting started

```bash
pnpm install
pnpm run:bundle
```

`run:bundle` builds the sidecars and the app, then opens `Kyuren.app`. Pull the local models once:

```bash
ollama pull qwen3.5:2b && ollama pull qwen3.5:9b && ollama pull nomic-embed-text
```

macOS ties the permissions it grants (microphone, camera, Screen Recording, Accessibility,
calendars, and Apple Events to control the music players) to an app's code signature, and asks
for each only when it is first needed. An unsigned build is a new app to macOS each time it is
rebuilt, so permissions are asked for again. To keep them, copy `.env.example` to `.env` and set
`APPLE_SIGNING_IDENTITY` to a code-signing identity of your own, which
`security find-identity -v -p codesigning` lists.

`pnpm dev` runs the app from source with live reloading, unsigned.

The app runs its sidecars from the checkout it was built in, so build it on the Mac it will run
on: a `Kyuren.app` copied to another machine will not start them.

## Privacy

- State lives under `~/.kyuren`, which no other account on the Mac can open: settings, the shelf,
  playbooks and their runs, and an event log of what Kyuren did, kept to its latest 10 MB and the
  10 MB before. Notes stay in the vaults they are in.
- Once a conversation has read your notes, Kyuren asks before anything leaves the machine, and
  shows what would be sent.
- The API key is kept in the Keychain and never written to disk or logs.
- Claude Code transcripts are read only when a session is opened on the island, and when a turn
  ends, for its counts alone. Nothing read from them is written anywhere.
- Answering Claude Code's permission prompts from the island adds one hook to
  `~/.claude/settings.json`, only once switched on, after keeping a backup; switching it off takes
  out only that hook.

## Tests

```bash
pnpm test
pnpm e2e
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

`pnpm test` runs the unit tests of the core and the windows. `pnpm e2e` drives the island in
WebKit, the engine its webview uses; the first run needs
`pnpm --filter @kyuren/desktop exec playwright install webkit`.

## Documents

- [.claude/KYUREN.md](.claude/KYUREN.md): the design, which governs everything else.
- [docs/ROADMAP.md](docs/ROADMAP.md): the order it was built in, with each stage's gate.
- [docs/PROTOCOL.md](docs/PROTOCOL.md): how the processes talk.
- [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md): measurements that settled design decisions.

## Licence

[MIT](LICENSE), copyright 2026 fuyu-myk. Every dependency and model weight is permissively
licensed: GPL code and non-commercial weights are excluded by policy, with two recorded
exceptions explained in [.claude/KYUREN.md](.claude/KYUREN.md). What this repository
redistributes, and under what terms, is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
