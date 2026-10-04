# Kyuren

Read `.claude/KYUREN.md` before any change. It is the authoritative design document and it
governs architecture and conventions. `docs/ROADMAP.md` governs construction order and gates.
KYUREN.md wins on conflict.

Conventions summarised, full text in KYUREN.md section 12:

- Comments default to none. Where required, one or two lines on why, never what.
- No em-dash anywhere. No emojis anywhere.
- Never use relative imports across modules.
- No references to roadmap stages or plan artifacts in code, comments, commits or documentation.
- Verify by running. A passing type check is not evidence a feature works.
- Core pipeline and architecture changes ship with a test locking the invariant.
- Many small focused files over few large ones.

Layout:

```
apps/desktop        Tauri v2 core (Rust) and the webview UI (pnpm, Vite, React, TypeScript)
sidecars/perception Swift executable: mic, VAD, STT, TTS, wake word, screen, hand pose, PDF text
sidecars/core       TypeScript: routing, agent loop, tools, permissions, memory, sessions
docs                ROADMAP.md and design notes
```
