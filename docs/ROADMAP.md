# ROADMAP

Construction order and gates. `.claude/KYUREN.md` governs design and wins on any conflict.

A stage is complete when its gate passes, demonstrated by running it, not by reasoning about it.
No stage begins before the previous stage's gate is green. Gates are written as observable checks
so that a cold session can verify them without context.

Every stage below is built, but not every gate is green: later stages were built while some earlier
checks were held only by tests or not yet seen at all, and those checks are the work that remains.
Each check ends with where it stands:

- **Recorded:** seen running, with the result written down in `docs/MEASUREMENTS.md` under the
  heading named, unless another file is named.
- **Tested:** held by the automated tests named, but not yet seen in the running app.
- **Not yet seen:** built, and neither recorded nor tested.
- **Failed:** measured, and short of the bar.
- **Not built.**

Tests are named by their path under `sidecars/core/src`, `apps/desktop` or
`sidecars/perception/Tests`, whichever holds them.

## Phase 1: The Spine

Stages 0 through 4 together are the first shippable version. The point of this phase is that one
real task travels the entire path, so that every later capability plugs into a proven route
instead of discovering the route for itself.

### Stage 0: Foundation

**Goal.** An empty application that can be rebuilt without losing permissions.

**Builds.** Repository layout and toolchain. Xcode installed and a signing identity established.
Tauri v2 shell with pnpm and Vite. Menu bar item. Global hotkey. A transparent non-activating
panel via `tauri-nspanel`. A Swift sidecar and a TypeScript sidecar, both speaking newline-delimited
JSON over stdio, both launched by the Rust core and killed when it quits. Two smaller native
programs joined them later: a short-lived helper for Apple's calendars and mail, and the relay
Claude Code runs to bring its permission prompts to the island.

**Gate.**
1. The hotkey summons a transparent borderless panel that appears above a full-screen application
   without switching spaces or stealing focus from the app underneath. *Not yet seen. The panel is
   the island now, and only what a click on it does to the app in front was measured.*
2. Both sidecars start, answer a ping over stdio, and are killed cleanly when the app quits. *Not
   yet seen. A sidecar that dies is not started again.*
3. A microphone permission granted before a rebuild is still granted after a rebuild. *Not yet
   seen.*

Check 3 is the one that matters. It is the difference between a usable development loop and an
unusable one.

**Risks.** `tauri-nspanel` tracks Tauri releases and needs a pinned version. What it does not do
for the island is done by hand through `objc2`, which is also the way out if it stops behaving.

### Stage 1: The Icosahedron

**Goal.** The visual identity, driven by the state protocol, before anything can drive it.

**Builds.** Clean-room Canvas 2D renderer per KYUREN.md section 9.1: golden-ratio icosahedron with
hand-rolled rotation and perspective projection, counter-rotating compressed rings, modulated
rays, particle spray and its glow. The state protocol of section 9.3, two channels, `energy` and
`state`, carried over Tauri events. Open and close transitions. A preview harness that drives its
state by hand. It was first drawn in a corner panel of its own, the orb; it now stands in the
island's voice tab, and the same drawing is the middle of the mind.

**Gate.**
1. The four states are distinguishable at a glance by someone who has not been told what they mean.
   *Not yet seen.*
2. Sustained sixty frames per second with the island open over a full-screen application. *Not yet
   seen.*
3. Driving `energy` visibly changes spin rate, ray length and glow together, confirming the
   single-scalar coupling. *Tested from energy to level, `src/island/level.test.ts`; the coupling
   itself not yet seen, and the harness has no control for energy.*

**Risks.** Compositing over a transparent webview background can behave differently from over an
opaque one. Verify early rather than at the end of the stage.

### Stage 2: Voice

**Goal.** Speech in and speech out, fast enough to feel like conversation.

**Builds.** The Swift sidecar in full: `AVAudioEngine` capture without voice processing, Silero
voice activity detection through FluidAudio, streaming Parakeet transcription on the Neural Engine
with every utterance transcribed again by a larger model once it ends, and Kokoro synthesis on the
Neural Engine, chunked by sentence and played through `AVAudioPlayer`. Apple's echo cancellation
cannot run beside Kyuren's own playback, so the microphone stays open while Kyuren speaks: being
spoken over interrupts a reply, as the hotkey does, and a transcript that repeats the reply is
discarded. Other audio is ducked while Kyuren speaks. Energy is the microphone's level while
listening and the reply's while speaking; partial transcripts stream to the UI as text.

**Gate.**
1. Time to first partial transcript is measured and recorded. Budget: under 400 ms from speech
   onset. *Failed, First partial after speech start: a median of 573 ms from when voice activity
   reports speech, nearer 830 ms from onset.*
2. Time to first audio out is measured and recorded. Budget: under 300 ms from the first token.
   *Failed as built: a reply is spoken once it is whole, so its first audio waits for its last
   token. Speaking itself begins 125 to 140 ms after it is asked for when warm, Latency after the
   fix, and about a second after for a conversation's first reply, Speech synthesis, cold paths.*
3. Speaking over a reply stops it, and the hotkey does too, with the queued audio discarded.
   *Recorded for the hotkey, Behaviour verified by running. Speaking over not yet seen.*
4. Playing audio through speakers while the microphone is live does not cause self-transcription.
   Must be tested on speakers, not headphones. *Recorded in part, Whether Kyuren hears itself: not
   at volumes 25 and 56; at 60 the reply partly came back, and a transcript repeating four words of
   it in a row is discarded, Telling the reply from the question.*
5. Every number above is written into the repository, not just observed once. *Recorded.*

**Risks.** The published Neural Engine latency figures are vendor self-reported and this stage is
where they are confirmed or refuted. The first partial refuted them. Apple's `SpeechAnalyzer` is
the fallback and costs no application size; it has not been tried.

### Stage 3: Cognition

**Goal.** A working agent that can be stopped.

**Builds.** The TypeScript core: Vercel AI SDK 7 as substrate, provider registrations for Ollama
and for the cloud provider, the routing policy from KYUREN.md section 5 with three routes, a judge
of how hard a request is, and a route the user may choose for a conversation. The agent loop with
streaming and tool dispatch. The permission gate with fingerprint-keyed decision memory, allows
kept between runs, and an audit log; once a conversation has read the user's notes, anything that
would leave the machine is asked about. The session store.

**Gate.**
1. An identical prompt routes to local or to cloud according to policy, demonstrated by forcing
   each of the four routing conditions in turn and observing the selection. *Tested,
   `model/route.test.ts`.*
2. With the network disabled, Kyuren still answers, degrades visibly, and says so. *Recorded, With
   the network gone.*
3. A tool call the user denies does not execute. Verified by a tool whose only effect is to write a
   file, then confirming the file does not exist. *Recorded, Behaviour verified by running.*
4. Approving one action does not approve a differently-shaped action carrying the same tool name.
   *Tested, `permission/action.test.ts` and `permission/gate.test.ts`.*
5. A running tool is interrupted mid-execution and the loop recovers without corrupt state.
   *Tested in part, `agent/tool.test.ts`: a tool told to stop, and a call stopped before it
   starts; nothing interrupts the loop part way through a tool. Stopping a turn is recorded,
   Behaviour verified by running; stopping a tool part way through its work is not.*
6. The measured quality gap between the local and the cloud path is recorded, answering open
   decision 3 in KYUREN.md. *Recorded on ten hard requests, Escalation. The morning brief, which
   this first named, is composed in code and no longer measures a model.*

**Risks.** This is the stage that replaces a ready-made agent SDK with our own composition, chosen
so that local and cloud are genuine peers rather than one being a proxy seam. The cost is that
permissions, sessions and interruption are ours to get right. Gate checks 3 through 5 exist because
those are exactly the parts a framework would have given us.

### Stage 4: Morning Brief

**Goal.** One real task, end to end, through every layer built so far.

**Builds.** Connectors behind one internal interface: Notion, Google Calendar and Gmail, Apple
Calendar and Apple Mail through EventKit and the Mail scripting interface, and Microsoft 365's
calendar and mail. Credential storage in the system keychain. Reading a connector is a gated action
like any tool, fingerprinted per source, so allowing one source never allows another. The
morning-brief capability: read what is overdue, the deadlines ahead and the events through tomorrow
across every connected source, triage unread mail, compose a spoken summary from those facts in
code rather than by a model, and write the day into the vault as one markdown note, whose block
Kyuren keeps and whose rest is the user's.

Notion Calendar is a front end over Google Calendar rather than a source of its own, so the Notion
connector supplies the dated items of its databases, two weeks back and three ahead, which is where
overdue work and deadlines come from, and the schedule proper arrives with Google.

**Gate.**
1. Hotkey, spoken request, spoken brief, with no keyboard or mouse touched between them. *Recorded
   in part: asked aloud and answered aloud, Who says the brief and With the network gone. The
   hotkey, and no hands between, are not written down, and nothing since the island replaced the
   orb.*
2. The brief is factually correct against the calendars, verified by reading them directly.
   *Tested, `brief/digest.test.ts` and `brief/speech.test.ts`. The one live comparison found a
   model retelling the facts wrongly, which is why the brief is composed in code; it has not been
   compared live since.*
3. Markdown for the day exists on disk, is readable and editable by hand, and a second reading of
   the same day keeps what was written there. *Tested, `brief/note.test.ts`. A hand edit was
   recalled live, Recall.*
4. With the network disabled the request fails gracefully and explains what it could not reach.
   *Recorded for the whole brief, With the network gone. Asked about today alone it says so too,
   tested, `brief/speech.test.ts`.*
5. Revoking one connector's credentials degrades that source only, and the brief still covers the
   rest. *Recorded, Reading a day across six sources.*
6. Allowing Kyuren to read one source does not allow it to read another. *Recorded, Reading a day
   across six sources; tested, `connect/read.test.ts`.*

**Phase 1 is complete when this gate passes.** At this point Kyuren is a real assistant that does
one thing, and every subsequent capability is an addition to a proven path rather than a new path.

It is in daily use without being complete by its own measure: stages 0 and 1 are not yet seen,
stage 2's budgets failed, and here three of six checks are recorded and one in part. Apple Mail
is read only while Mail runs and has not been read live.

## Phase 2: The Mind

### Stage 5: Memory

**Goal.** Recall that survives hand-editing.

**Builds.** The vault, its frontmatter schema and its link format. The file watcher. Content-hash
chunking and incremental embedding through `nomic-embed-text`. Hybrid retrieval by vector
similarity and full-text search fused by reciprocal rank, with a third list, of the chunks about
the entities a question names. Entity resolution by how names are written, so that a shorter form
joins the one longer form containing it. Obsidian vault connection, each connected folder read
only, asked about or written, as the user sets it. Notion two-way connector under the same three
settings.

**Gate.**
1. Editing a markdown file by hand in an external editor changes what Kyuren recalls, within five
   seconds, with no restart. *Recorded, Recall: 0.4 s.*
2. Deleting the entire index and rebuilding it loses nothing. *Recorded, Recall, over three files.*
3. Re-embedding after a one-line edit to a large file re-embeds only the affected chunks,
   demonstrated by count. *Recorded on small notes, Recall: one chunk embedded again. No large file
   has been tried; that an edit hashes only the chunk it touched is tested,
   `memory/chunk.test.ts`.*
4. The same person mentioned across nine notes resolves to one entity with nine mentions. *Tested,
   `entity/resolve.test.ts`. The run recorded under Who the notes are about used the embedding
   resolver since replaced.*
5. Recall latency for a typical query is measured and recorded. *Recorded, Recall: a 12 ms median.*

**Risks.** Resolution by how names are written has no threshold to tune; what needs tuning instead
is what counts as a name. The first real vault, 263 notes, had sentence openers and template
headings taken for names. Expect each new vault to show more.

### Stage 6: Mind Graph

**Goal.** The layers, navigable.

**Builds.** The full-screen graph overlay. Force-directed simulation laid out as a whirlpool of
spiral arms around the icosahedron. Four layers, toggled independently: memory from the vault
graph, live reasoning from the current session's trace, capability from the registered tools,
skills and playbooks, and the connected vaults. Pointer interaction built properly from the start,
which is the part the reference implementation never had: drag to move a node, drag empty space to
spin the whole, which coasts on when let go, and to tilt it, wheel to zoom, click to focus, number
keys for the layers, escape to dismiss. Past eighty orbs, a crowding factor shrinks them and dims
the threads between them, so a large mind stays legible without the small one changing.

**Gate.**
1. Dragging, zooming and focusing all work with mouse and trackpad, including inertia and clamped
   zoom limits. *Tested, `src/mind/space.test.ts` and `src/mind/render.test.ts`.*
2. Layers toggle independently and the graph stays stable across a toggle rather than re-seeding.
   *Tested, `src/mind/mind.test.ts`.*
3. While a task runs, the reasoning layer updates live and shows tool calls as they happen. *Not
   yet seen.*
4. A graph with one thousand nodes remains interactive. *Recorded in the browser preview, The mind
   at a thousand orbs and more: 44 frames a second at 4800 orbs. The simulation is tested,
   `src/mind/simulation.test.ts`.*
5. Clicking a capability node invokes it. *Built for two capabilities, today and remember; not yet
   seen.*

**Risks.** Force simulation at scale is the performance cliff. At 4800 orbs the preview first drew
one frame a second; stroking threads in bundles and letting the simulation rest once calm brought it
to 44. The graph draws every note and everything Kyuren's own notes mention; from a connected
vault, only what joins two notes, and only as much as keeps the whole within a thousand.

## Phase 3: The Workspace

### Stage 7: Panes and Chat Hub

**Goal.** The application window earns its existence.

**Builds.** Capability panes, each owning its sessions and acting as an organiser for its domain:
comms and calendar, knowledge and memory, development and projects, and research. The chat hub as
a consolidating surface listing every session across every pane by recency, able to invoke anything
any pane can, and a slash command in any pane does the same. One session store, each session
belonging to its pane. Session persistence and resumption, each conversation keeping the route
chosen for it.

**Gate.**
1. A session started in a pane appears in the hub and can be resumed from either surface with full
   context. *Tested, `session/store.test.ts` and `session/thread.test.ts`.*
2. The hub can invoke a capability belonging to any pane without the user opening that pane. *Not
   yet seen.*
3. Sessions survive an application restart. *Tested, `session/store.test.ts`.*
4. Session list ordering by recency is correct across panes. *Tested, `session/store.test.ts` and
   `session/thread.test.ts`.*

### Stage 8: Development Pane

**Goal.** Forty-eight repositories made tractable.

**Builds.** Cross-repository situational awareness on one board: branch, working tree state and
unpushed commits, refreshed on a timer and when the window comes forward. Supervised coding
sessions, Claude Code in read-only plan mode, spawned into the correct repository and awaited for
up to ten minutes by the core, though the window stops waiting for any turn after five. Where a
project stood when work stopped, answered on demand from its README, its
working tree and its last commits. Coding agents running anywhere on the Mac are followed on the
island. Not built: open pull requests and continuous integration status on the board, and a record
of what was decided.

**Gate.**
1. The board reflects real state across every repository under the coding directory, refreshed
   without a manual trigger. *Not yet seen; pull requests and continuous integration are not
   built.*
2. A spawned coding session runs in the right repository and its result is reported back into the
   pane. *Not yet seen. Finding the repository and reading the report are tested,
   `projects/recall.test.ts` and `projects/spawn.test.ts`. A session that runs past five minutes
   shows as timed out in the pane while it goes on.*
3. Asking about a project untouched for six months returns a useful answer about where it stopped.
   *Tested against a fixture, `projects/recall.test.ts`.*
4. Scanning every repository does not block the interface. *Not yet seen; scanning a handful at
   a time is tested, `projects/pool.test.ts`.*

## Phase 4: Growth

### Stage 9: Skill Forge

**Goal.** Kyuren extends itself, and the user stays in control of it.

**Builds.** The skill schema from KYUREN.md section 8: a stored request template that reaches only
the public web over https. A forge tool the model drafts with, every draft inert. The
pending-approval queue in the GUI. Approved skills called by name through one skill tool, the first
call after each approval asked about whatever its host was allowed before. Every skill in the
capability layer of the mind from the moment it is drafted. Not built: tools for the model to test
or edit a skill, and a window for entering a skill's credential.

**Gate.**
1. Given an API's documentation, Kyuren drafts a working skill and the draft is inert until
   approved. *Tested for inertness, `skill/store.test.ts` and `agent/skill.test.ts`; drafting from
   documentation not yet seen.*
2. An unapproved skill cannot be invoked by any path, including one the model constructs itself.
   *Tested, `skill/run.test.ts`, `skill/store.test.ts` and `agent/skill.test.ts`, and no file tool
   may write the skill store, `permission/guarded.test.ts`. No adversarial run is recorded.*
3. An approved skill appears in the capability layer and is callable from the chat hub. *Tested for
   the call, `agent/skill.test.ts`; the listing not yet seen.*
4. A skill whose endpoint has started failing is reported as broken rather than retried silently.
   *Tested, `skill/run.test.ts`.*
5. Skill credentials are stored in the keychain and never appear in a prompt, a log or the graph.
   *Tested for keeping them out, `skill/call.test.ts` and `skill/run.test.ts`; entering one is not
   built.*

**Risks.** This is the largest security surface in the project, because it is the model pointing
new network requests at the internet. Gate check 2 is the load-bearing one and deserves adversarial
testing, not a happy-path demonstration.

## Phase 5: Presence

### Stage 10: Vision Mode

**Goal.** Reaching into the graph.

**Builds.** Hand tracking in the perception sidecar: MediaPipe's palm detector and hand landmarks,
run through ONNX Runtime, following up to two hands. Apple's Vision framework did this first and
was replaced, since it found the hand afresh every frame and the cursor flickered. Gesture
vocabulary: pinch to grab a node, open hand to release, a held fist for the next layer, a point
with the thumb on the middle finger to read a node, and the other hand's raised finger to hold
what is lit while the first moves. Camera opens only on entering vision mode and closes on exit.
On-demand screen capture as a separate capability with its own explicit trigger. Not built:
lateral motion to rotate.

**Gate.**
1. Pinching in the air grabs the node under the cursor projection and dragging moves it. *Tested,
   `src/mind/reach.test.ts`; used live while it was tuned, not recorded.*
2. The camera indicator is off whenever vision mode is closed, verified at the system level. *Not
   yet seen.*
3. Pointer interaction from stage 6 still works unchanged with vision mode available. *Not yet
   seen with vision on; the pointer alone is tested, `src/mind/space.test.ts` and
   `src/mind/render.test.ts`.*
4. No camera frame reaches any model other than the local hand tracker, verified by inspecting
   outbound traffic. *Tested for what the tracker sends, `PerceptionCoreTests/TrackerTests.swift`;
   traffic not yet inspected.*

### Stage 11: Wake Word and Ambient Presence

**Goal.** Kyuren notices things without being asked, and rarely says so.

**Builds.** An in-house trained wake word head for "Hey Kyuren" on openWakeWord's Apache-2.0
feature models, for licensing reasons stated in KYUREN.md section 10. A wake needs two chunks in a
row at 0.70 and speech heard in the last 1.5 s. Always-on listening as an explicit opt-in with
clear indication. Ambient rules: a small set of user-defined high-signal conditions that may
surface on the island, and a much smaller set that may break silence with speech. Naming a source
in the rules is the permission to read it unattended, and every look is announced.

**Gate.**
1. False accept rate measured over eight hours of ordinary ambient audio, recorded with the
   threshold chosen. *Recorded in part, beside the model in
   `sidecars/perception/Sources/PerceptionCore/Audio/Hearing/SOURCE.md`: at 0.70, 7.14 an
   hour over 6.16 hours of read speech and noise, and none in 49 minutes of the user's room. Not
   eight hours of ordinary audio, and the speech requirement added after a lived-in room woke it is
   not measured.*
2. False reject rate measured across a spoken test set. *Recorded, `Hearing/SOURCE.md`: 0.8% of
   880 held-out clips, and 4% of 50 takes by one speaker.*
3. Wake word can be disabled completely, and when disabled the microphone is genuinely closed. *Not
   yet seen.*
4. Ambient notifications fire only on conditions the user defined, demonstrated by a week of logs
   with zero unrequested interruptions. *Tested, `ambient/match.test.ts` and
   `ambient/watch.test.ts`; no week of logs.*

## Phase 6: Playbooks

### Stage 12: Playbook Substrate

**Goal.** Every task Kyuren does is a written procedure with a proof, and every run leaves a
record.

**Builds.** The playbook schema from KYUREN.md section 13, stored as markdown under
`~/.kyuren/playbooks/`, beside the vault rather than in it. The proof runner with its machine checks,
and a judge for what cannot be measured. The run log, written for a run the model gave up on as
well. A `playbook` tool that runs one, and a pending-approval path in the GUI for authored
playbooks. Playbooks in the capability layer of the mind. Not built: procedure skills.

**Gate.**
1. A run ends with every proof item recorded as passed or failed, with why. *Recorded, Playbooks
   run end to end; tested, `playbook/runlog.test.ts` and `playbook/runner.test.ts`.*
2. A run whose proof fails is reported as failed with the item, never as done. *Recorded,
   Playbooks run end to end; tested, `playbook/runner.test.ts`.*
3. An unapproved playbook cannot be run by any path, including one the model constructs itself.
   *Tested, `playbook/runner.test.ts`, `playbook/store.test.ts` and `permission/guarded.test.ts`;
   no adversarial run is recorded.*
4. Every run has a log holding every tool call with the gate's decision on it. *Recorded, Playbooks
   run end to end; tested, `playbook/runner.test.ts`, a run the model gave up on included.*
5. The author tool is unavailable on local routes, demonstrated by asking the local model for it.
   *Tested, `agent/playbook.test.ts`; not yet asked of the local model.*

### Stage 13: The Repair Loop

**Goal.** A failed run makes the next one better, and the user sees the change before it counts.

**Builds.** The author path: the cloud model, given a run log and the playbook, proposes an edit
that lands as pending with its diff. A repair proposes that playbook alone without a question; the
store refuses a proposal that gives it new skills, and one under another name is asked about. Not
built: the same through a Claude Code session.

**Gate.**
1. A playbook broken on purpose is repaired from its own run log, and the repair is pending with a
   diff beside the run that prompted it. *Recorded, Playbooks run end to end; tested,
   `playbook/repair.test.ts`.*
2. Nothing runs the repaired text until it is approved; after approval the next run's proof
   passes. *Recorded once, Playbooks run end to end, the next run passing after a change to
   `write_file` the repair itself named. That nothing runs a repair before approval is tested,
   `playbook/repair.test.ts` and `playbook/store.test.ts`; a passing run after one is not.*
3. A run log that contains an instruction addressed to the model, planted in fetched content, does
   not end up in the playbook. *Recorded once, Playbooks run end to end, with the instruction
   planted in the log itself. A new skill is refused by the store and another name is asked
   about, `playbook/repair.test.ts`; a change to the steps or the proof rests on the user reading
   the diff.*

### Stage 14: Playbooks That Reach Out

**Goal.** Research, automation and parallel work, each as a playbook on the substrate rather than
a system of its own.

**Builds.** Web search and fetch as native tools through a hidden reader window of Kyuren's own,
with no dependency taken: everything the reader fetches goes out through Kyuren's own proxy, which
refuses this machine and its network, and a PDF is read by the perception sidecar through the same
proxy. A second search engine when the first refuses. Time triggers beside the ambient rules, so a
playbook can run on a schedule. Sub-runs: a step that runs other playbooks a handful at a time
through the pool that already runs repositories. Proofs that check a note's citations, and
research playbooks built on them, kept with the user's playbooks rather than in this repository.

**Gate.**
1. A research playbook produces a note whose proof includes the sources it cites, each fetched.
   *Recorded, Playbooks run end to end; tested, `playbook/proof.test.ts` and
   `playbook/runner.test.ts`.*
2. A scheduled playbook runs at its time, logs its run, and fires nothing the schedule did not
   name. *Recorded in part, in a scratch home, Playbooks run end to end: it fired at its minute,
   once. That it logs its run and fires nothing else is tested, `ambient/schedule.test.ts`.*
3. Sub-runs each leave their own log, and the parent's proof includes theirs. *Recorded, Playbooks
   run end to end; tested, `agent/playbook.test.ts` and `playbook/runner.test.ts`, a sub-run the
   model gave up on included.*
4. Nothing on this machine or its network is read, whether it is named by its address or by a name
   that leads there. *Recorded, On the built app: `http://localhost:11434` refused. Tested,
   `connect/web/nearby.test.ts`, `PerceptionCoreTests/NearbyTests.swift`,
   `src-tauri/src/nearby.rs` and `src-tauri/src/reader_proxy.rs`.*

## Phase 7: The Island

### Stage 15: The Island

**Goal.** Kyuren lives at the notch: what it is doing, and what is waiting on the user, a glance
away and never in the way.

**Builds.** The island of KYUREN.md section 9.2: a non-activating panel above the menu bar that
grows out of the notch, or out of a short bar on a screen without one, on whichever screen the
cursor is. A hover opens it, and the cursor leaving, a press outside it or another app coming
forward folds it; a question, a notice or a summons holds it out only until the cursor has been to
it. Its tabs, each one switchable off and arranged by dragging in settings: voice and answers, with
the icosahedron and a composer; the questions waiting on the user, Kyuren's own and Claude Code's,
which the relay brings; work in progress; the coding agents running on the Mac, a Claude Code
session's steps opening whole; a glance of widgets; shortcuts that run playbooks; a shelf of files
on their way somewhere; and notices. Each window may call only the commands its own code calls, and
the reader none at all.

**Gate.**
1. A hover held on the notch opens the island on its tabs; the cursor leaving, a press outside it,
   or another app coming forward folds it. *Tested, `e2e/island.spec.ts`,
   `src/island/fsm.test.ts` and `src-tauri/src/island.rs`; in daily use, not recorded.*
2. A question opens the island on it and holds it out until the cursor has been there; answered on
   the island or in the main window, it is gone from both. *Tested, `src/island/fsm.test.ts`,
   `e2e/island.spec.ts` and `e2e/main.spec.ts`. Failed on the built app before the main window
   let go of answered questions, On the built app; not yet seen since.*
3. Outside what the island draws, a click reaches what is beneath it, the menu bar included.
   *Tested, `src-tauri/src/island.rs`; not yet seen.*
4. A Claude Code permission prompt shown whole is answered on the island and Claude Code does as
   answered; one the island has not taken within three seconds, or has not answered in time, goes
   back to Claude Code's own prompt. *Recorded for allow, The Claude Code relay, live. Which
   questions are shown whole is tested, `coding/asked.test.ts`, and handing one back, on timings
   of the test's own, `coding/hooks.test.ts`.*
5. Each window may call exactly the commands its own code calls, and the reader none. *Recorded
   in part, On the built app: nothing failed for want of a permission. That each may call exactly
   its own, and the reader none, is tested, `src/windows.test.ts`.*

## Risk register

| Risk | Stage | Mitigation |
| --- | --- | --- |
| Permission grants lost on every rebuild | 0 | Stable signing identity before any permission-touching code. Gate check 0.3. |
| Neural Engine latency figures are vendor-reported and unconfirmed | 2 | Measured in gate 2.1, and the first partial missed its budget. Apple `SpeechAnalyzer` is the fallback, not yet tried. Gate 2.2 fails for another reason: a reply is spoken only once it is whole. |
| Building the agent loop instead of adopting one | 3 | Gate checks 3.3 through 3.5 target exactly the parts a framework would have supplied. |
| Local model quality gap makes hybrid routing a downgrade | 3 | Measured in gate 3.6: hard requests go to the cloud whenever it is set up. Policy is data-driven, and routing thresholds move with the evidence. |
| Force simulation collapses at scale | 6 | Gate 6.4 sets the bar at one thousand nodes. |
| Forged skills as an attack surface | 9 | Inert on creation, approval required, the first call after each approval asked about, the skill store out of every file tool's reach, and adversarial testing of gate 9.2. |
| Always-on microphone as a privacy and battery cost | 11 | Opt-in, measured false accept rate, genuinely closable, which is gate 11.3 and not yet seen. Battery cost not yet measured. |
| A playbook as a prompt-injection surface | 12 to 14 | Frontier-only authoring, pending approval of the text, a repair proposing only its own playbook without a question, gate 13.3. A run that names the web tools reads the web without a question per address, which widens it; anything that would carry the user's notes off the machine is asked about, and a run's inputs reach a proof's command only as values. |
| The reader as a way into this machine and its network | 14 | Its own proxy, which looks each name up itself and refuses nearby addresses, its own data store and content rules, WebRTC off, and no way to call anything in Kyuren. Gate 14.4. |
| Scope growth across seven phases | all | Non-goals in KYUREN.md section 2. Phase 1 ships alone and is useful alone. |

## Resuming cold

A session with no prior context should read `.claude/KYUREN.md` in full, then this file, then
determine the current stage by running the most recent completed stage's gate. Gates are the
checkpoint. Progress notes belong in commits and in stage gates, not in prose appended here.
