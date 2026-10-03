# ROADMAP

Construction order and gates. `.claude/KYUREN.md` governs design and wins on any conflict.

A stage is complete when its gate passes, demonstrated by running it, not by reasoning about it.
No stage begins before the previous stage's gate is green. Gates are written as observable checks
so that a cold session can verify them without context.

## Phase 1: The Spine

Stages 0 through 4 together are the first shippable version. The point of this phase is that one
real task travels the entire path, so that every later capability plugs into a proven route
instead of discovering the route for itself.

### Stage 0: Foundation

**Goal.** An empty application that can be rebuilt without losing permissions.

**Builds.** Repository layout and toolchain. Xcode installed and a signing identity established.
Tauri v2 shell with pnpm and Vite. Menu bar item. Global hotkey. An empty transparent
non-activating panel via `tauri-nspanel`. A stub Swift sidecar and a stub TypeScript sidecar, both
speaking newline-delimited JSON over stdio, both launched and supervised by the Rust core.

**Gate.**
1. The hotkey summons a transparent borderless panel that appears above a full-screen application
   without switching spaces or stealing focus from the app underneath.
2. Both sidecars start, answer a ping over stdio, and are killed cleanly when the app quits.
3. A microphone permission granted before a rebuild is still granted after a rebuild.

Check 3 is the one that matters. It is the difference between a usable development loop and an
unusable one, and it is cheapest to fix now.

**Risks.** Xcode is a large install and is not yet present. `tauri-nspanel` tracks Tauri releases
and may need a specific version pin. If the panel cannot be made to behave, the fallback is a
hand-written `NSPanel` reached through `objc2`, which is more code but fully under our control.

### Stage 1: The Orb

**Goal.** The visual identity, driven by the state protocol, before anything can drive it.

**Builds.** Clean-room Canvas 2D renderer per KYUREN.md section 9.1: golden-ratio icosahedron with
hand-rolled rotation and perspective projection, counter-rotating compressed rings, modulated
rays, particle spray, additive glow. The four-channel state protocol from section 9.2, carried
over Tauri events. Open and close transitions. A development harness that drives every channel by
hand.

**Gate.**
1. The four states are distinguishable at a glance by someone who has not been told what they mean.
2. Sustained sixty frames per second with the panel open over a full-screen application.
3. Driving `energy` from the harness visibly changes spin rate, ray length and glow together,
   confirming the single-scalar coupling.
4. The panel is click-through: clicking where the orb is drawn reaches the application beneath it.

**Risks.** Additive compositing over a transparent webview background can behave differently from
over an opaque one. Verify early rather than at the end of the stage.

### Stage 2: Voice

**Goal.** Speech in and speech out, fast enough to feel like conversation.

**Builds.** The Swift sidecar in full: `AVAudioEngine` capture, Silero VAD, streaming Parakeet
transcription on the Neural Engine, Kokoro synthesis on the Neural Engine chunked by sentence.
Interruption: the hotkey cancels synthesis and flushes the audio queue. Partial transcripts stream
to the orb as `energy` and to the UI as text.

**Gate.**
1. Time to first partial transcript is measured and recorded. Budget: under 400 ms from speech
   onset.
2. Time to first audio out is measured and recorded. Budget: under 300 ms from the first token.
3. Speaking over a reply stops it, and the hotkey does too, with the queued audio discarded.
4. Playing audio through speakers while the microphone is live does not cause self-transcription.
   Must be tested on speakers, not headphones.
5. Every number above is written into the repository, not just observed once.

**Risks.** The published Neural Engine latency figures are vendor self-reported and this stage is
where they are confirmed or refuted. If FluidAudio disappoints, Apple's `SpeechAnalyzer` is the
fallback and costs no application size.

### Stage 3: Cognition

**Goal.** A working agent that can be stopped.

**Builds.** The TypeScript core: Vercel AI SDK 7 as substrate, provider registrations for Ollama
and for the cloud provider, the routing policy from KYUREN.md section 5, the agent loop with
streaming and tool dispatch, the permission gate with fingerprint-keyed decision memory and an
audit log, and the session store.

**Gate.**
1. An identical prompt routes to local or to cloud according to policy, demonstrated by forcing
   each of the four routing conditions in turn and observing the selection.
2. With the network disabled, Kyuren still answers, degrades visibly, and says so.
3. A tool call the user denies does not execute. Verified by a tool whose only effect is to write a
   file, then confirming the file does not exist.
4. Approving one action does not approve a differently-shaped action carrying the same tool name.
5. A running tool is interrupted mid-execution and the loop recovers without corrupt state.
6. The measured quality gap between the local and cloud path on the morning-brief task is recorded,
   answering open decision 3 in KYUREN.md.

**Risks.** This is the stage that replaces a ready-made agent SDK with our own composition, chosen
so that local and cloud are genuine peers rather than one being a proxy seam. The cost is that
permissions, sessions and interruption are ours to get right. Gate checks 3 through 5 exist because
those are exactly the parts a framework would have given us.

### Stage 4: Morning Brief

**Goal.** One real task, end to end, through every layer built so far.

**Builds.** Connectors behind one internal interface: Notion, Google Calendar and Gmail, Apple
Calendar and Apple Mail through EventKit and the Mail scripting interface, and Microsoft 365. Credential storage in the system keychain. Reading a connector is a gated action
like any tool, fingerprinted per source, so allowing one source never allows another. The
morning-brief capability: read today's schedule across every connected source, triage unread mail,
compose a spoken summary of roughly thirty seconds, and write the day's entities into the memory
vault as markdown.

Notion Calendar is a front end over Google Calendar rather than a source of its own, so the Notion
connector supplies database items dated today and the schedule proper arrives with Google.

**Gate.**
1. Hotkey, spoken request, spoken brief, with no keyboard or mouse touched between them.
2. The brief is factually correct against the calendars, verified by reading them directly.
3. Markdown files for the day's entities exist on disk, are readable and editable by hand, and a
   second reading of the same day keeps what was written there.
4. With the network disabled the request fails gracefully and explains what it could not reach.
5. Revoking one connector's credentials degrades that source only, and the brief still covers the
   rest.
6. Allowing Kyuren to read one source does not allow it to read another.

**Phase 1 is complete when this gate passes.** At this point Kyuren is a real assistant that does
one thing, and every subsequent capability is an addition to a proven path rather than a new path.

The gate passes. Six sources, each separately allowed and independently able to fail; the brief
spoken from the facts rather than retold; the day written as markdown that survives being edited;
and the whole of it correct with the network gone. What each check measured is in MEASUREMENTS.

## Phase 2: The Mind

### Stage 5: Memory

**Goal.** Recall that survives hand-editing.

**Builds.** The vault, its frontmatter schema and its link format. The file watcher. Content-hash
chunking and incremental embedding through `nomic-embed-text`. Hybrid retrieval by vector
similarity and full-text search fused by reciprocal rank. Entity extraction with cosine-threshold
deduplication. Obsidian vault connection. Notion two-way connector.

**Gate.**
1. Editing a markdown file by hand in an external editor changes what Kyuren recalls, within five
   seconds, with no restart.
2. Deleting the entire index and rebuilding it loses nothing.
3. Re-embedding after a one-line edit to a large file re-embeds only the affected chunks,
   demonstrated by count.
4. The same person mentioned across nine notes resolves to one entity with nine mentions.
5. Recall latency for a typical query is measured and recorded.

**Risks.** Entity deduplication thresholds are empirical. Expect to tune them against real notes
rather than synthetic ones, and record the chosen values with the evidence.

### Stage 6: Mind Graph

**Goal.** The three layers, navigable.

**Builds.** The full-screen graph overlay. Force-directed simulation with a spherical initial
layout. Three toggleable layers: memory from the vault graph, live reasoning from the current
session's trace, and capability from the registered tools and skills. Pointer interaction built
properly from the start, which is the part the reference implementation never had: drag to move a
node, wheel to zoom, click to focus and expand, escape to dismiss.

**Gate.**
1. Dragging, zooming and focusing all work with mouse and trackpad, including inertia and clamped
   zoom limits.
2. Layers toggle independently and the graph stays stable across a toggle rather than re-seeding.
3. While a task runs, the reasoning layer updates live and shows tool calls as they happen.
4. A graph with one thousand nodes remains interactive.
5. Clicking a capability node invokes it.

**Risks.** Force simulation at scale is the performance cliff. If one thousand nodes is not
interactive in the simulation as written, the fix is spatial partitioning or a worker thread, not
fewer nodes.

## Phase 3: The Workspace

### Stage 7: Panes and Chat Hub

**Goal.** The application window earns its existence.

**Builds.** Three capability panes, comms and calendar, knowledge and memory, and development and
projects, each owning its own sessions and acting as an organiser for its domain. The chat hub as
a consolidating surface listing every session across every pane by recency, able to invoke anything
any pane can. Session persistence and resumption.

**Gate.**
1. A session started in a pane appears in the hub and can be resumed from either surface with full
   context.
2. The hub can invoke a capability belonging to any pane without the user opening that pane.
3. Sessions survive an application restart.
4. Session list ordering by recency is correct across panes.

### Stage 8: Development Pane

**Goal.** Forty-eight repositories made tractable.

**Builds.** Cross-repository situational awareness: branch, working tree state, unpushed commits,
open pull requests and continuous integration status, on one board. Supervised coding sessions
spawned into the correct repository and tracked to completion. Project memory recording what each
project is, where work stopped, and what was decided.

**Gate.**
1. The board reflects real state across every repository under the coding directory, refreshed
   without a manual trigger.
2. A spawned coding session runs in the right repository and its result is reported back into the
   pane.
3. Asking about a project untouched for six months returns a useful answer about where it stopped.
4. Scanning every repository does not block the interface.

## Phase 4: Growth

### Stage 9: Skill Forge

**Goal.** Kyuren extends itself, and the user stays in control of it.

**Builds.** The skill schema from KYUREN.md section 8. Authoring, testing and editing tools
available to the model. The pending-approval queue in the GUI. Approved skills registered as
callable tools and surfaced in the capability layer of the mind graph.

**Gate.**
1. Given an API's documentation, Kyuren drafts a working skill and the draft is inert until
   approved.
2. An unapproved skill cannot be invoked by any path, including one the model constructs itself.
3. An approved skill appears in the capability layer and is callable from the chat hub.
4. A skill whose endpoint has started failing is reported as broken rather than retried silently.
5. Skill credentials are stored in the keychain and never appear in a prompt, a log or the graph.

**Risks.** This is the largest security surface in the project, because it is the model pointing
new network requests at the internet. Gate check 2 is the load-bearing one and deserves adversarial
testing, not a happy-path demonstration.

## Phase 5: Presence

### Stage 10: Vision Mode

**Goal.** Reaching into the graph.

**Builds.** Hand pose detection through Apple's Vision framework in the perception sidecar. Gesture
vocabulary: pinch to grab a node, open hand to release, fist to switch layers, lateral motion to
rotate. Camera opens only on entering vision mode and closes on exit. On-demand screen capture as a
separate capability with its own explicit trigger.

**Gate.**
1. Pinching in the air grabs the node under the cursor projection and dragging moves it.
2. The camera indicator is off whenever vision mode is closed, verified at the system level.
3. Pointer interaction from stage 6 still works unchanged with vision mode available.
4. No camera frame reaches any model other than the local hand tracker, verified by inspecting
   outbound traffic.

### Stage 11: Wake Word and Ambient Presence

**Goal.** Kyuren notices things without being asked, and rarely says so.

**Builds.** An in-house trained wake word model, for licensing reasons stated in KYUREN.md section
10. Always-on listening as an explicit opt-in with clear indication. Ambient rules: a small set of
user-defined high-signal conditions that may surface through the orb, and a much smaller set that
may break silence with speech.

**Gate.**
1. False accept rate measured over eight hours of ordinary ambient audio, recorded with the
   threshold chosen.
2. False reject rate measured across a spoken test set.
3. Wake word can be disabled completely, and when disabled the microphone is genuinely closed.
4. Ambient notifications fire only on conditions the user defined, demonstrated by a week of logs
   with zero unrequested interruptions.

## Phase 6: Playbooks

### Stage 12: Playbook Substrate

**Goal.** Every task Kyuren does is a written procedure with a proof, and every run leaves a
record.

**Builds.** The playbook and procedure skill schemas from KYUREN.md section 13, stored as
markdown in Kyuren's own vault. The proof runner with its machine checks. The run log. A
`playbook` tool that runs one, and a pending-approval path in the GUI for authored playbooks.
Playbooks and procedure skills in the capability layer of the mind.

**Gate.**
1. A run ends with every proof item recorded as passed or failed, with why.
2. A run whose proof fails is reported as failed with the item, never as done.
3. An unapproved playbook cannot be run by any path, including one the model constructs itself.
4. Every run has a log holding every tool call with the gate's decision on it.
5. The author tool is unavailable on local routes, demonstrated by asking the local model for it.

### Stage 13: The Repair Loop

**Goal.** A failed run makes the next one better, and the user sees the change before it counts.

**Builds.** The author path: a frontier model, through the cloud route or a Claude Code session,
given a run log and the playbook, proposes an edit that lands as pending with its diff.

**Gate.**
1. A playbook broken on purpose is repaired from its own run log, and the repair is pending with
   a diff beside the run that prompted it.
2. Nothing runs the repaired text until it is approved; after approval the next run's proof
   passes.
3. A run log that contains an instruction addressed to the model, planted in fetched content,
   does not end up in the playbook.

### Stage 14: Playbooks That Reach Out

**Goal.** Research, automation and parallel work, each as a playbook on the substrate rather than
a system of its own.

**Builds.** Web search and fetch as skills, behind a dependency decision. Time triggers beside
the ambient rules, so a playbook can run on a schedule. Sub-runs: a step that runs other
playbooks a handful at a time through the pool that already runs repositories.

**Gate.**
1. A research playbook produces a note whose proof includes the sources it cites, each fetched.
2. A scheduled playbook runs at its time, logs its run, and fires nothing the schedule did not
   name.
3. Sub-runs each leave their own log, and the parent's proof includes theirs.

## Risk register

| Risk | Stage | Mitigation |
| --- | --- | --- |
| Permission grants lost on every rebuild | 0 | Stable signing identity before any permission-touching code. Gate check 0.3. |
| Neural Engine latency figures are vendor-reported and unconfirmed | 2 | Measured in gate 2.1 and 2.2. Apple `SpeechAnalyzer` is the fallback. |
| Building the agent loop instead of adopting one | 3 | Gate checks 3.3 through 3.5 target exactly the parts a framework would have supplied. |
| Local model quality gap makes hybrid routing a downgrade | 3 | Measured in gate 3.6. Policy is data-driven, and routing thresholds move with the evidence. |
| Force simulation collapses at scale | 6 | Gate 6.4 sets the bar at one thousand nodes. |
| Forged skills as an attack surface | 9 | Inert on creation, approval required, adversarial testing of gate 9.2. |
| Always-on microphone as a privacy and battery cost | 11 | Opt-in, last stage, measured false accept rate, genuinely closable. |
| A playbook as a prompt-injection surface | 12 to 14 | Frontier-only authoring, pending approval of the text, gate 13.3. |
| Scope growth across five phases | all | Non-goals in KYUREN.md section 2. Phase 1 ships alone and is useful alone. |

## Resuming cold

A session with no prior context should read `.claude/KYUREN.md` in full, then this file, then
determine the current stage by running the most recent completed stage's gate. Gates are the
checkpoint. Progress notes belong in commits and in stage gates, not in prose appended here.
