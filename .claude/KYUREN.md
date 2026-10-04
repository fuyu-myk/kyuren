# KYUREN

Authoritative design document. Read it before any change.

KYUREN.md governs design and conventions. `docs/ROADMAP.md` governs construction order and
gates. On conflict, KYUREN.md wins.

## 1. What Kyuren is

A personal assistant for one person on one machine. Summoned by a global hotkey, prompted by
voice or by text, it executes real tasks against real accounts and reports back by voice and
through an island that grows out of the notch. It keeps a persistent memory the user can read and edit as plain
markdown, and it exposes that memory, its live reasoning, and its own capability set as one
navigable graph.

It is not a chat window with a microphone attached. The test of every feature is whether it
causes something to happen.

## 2. Target and non-goals

Target: macOS 26 on Apple Silicon. Single user, single machine, local state.

Non-goals, recorded so they stay non-goals:

- No mobile companion app, no phone client, no access to Kyuren from off the machine.
- No hosted service, no accounts, no multi-user, no cross-device sync.
- No Mac App Store distribution. Accessibility API access and unsandboxed helper processes are
  incompatible with the App Sandbox, and Apple has confirmed this is not grantable by the user.
- No wholesale adoption of any existing assistant framework as the core. Prior art is read and
  learned from, not forked.

Licensing posture: the repository is intended to be published. Every dependency and every model
weight must carry a permissive license. GPL code and non-commercial model weights are excluded
by policy, not by preference. See section 10.

## 3. Principles

1. **Voice first, never voice only.** Every capability is reachable by text. Voice is the fastest
   path to the same surface, not a separate product.
2. **Local by default, cloud by need.** The router decides per request using an explicit policy,
   not a vibe. A request that can be served locally is served locally.
3. **Memory is a file the user owns.** Markdown on disk is the source of truth. Every index,
   embedding and graph edge is a disposable cache that can be deleted and rebuilt.
4. **Capability is visible.** Anything Kyuren can do appears as a node in the mind graph. Hidden
   capability is a bug.
5. **Nothing acts without a gate it cannot bypass.** The permission layer sits below the model,
   not inside the prompt. A model cannot talk its way past it.
6. **State is legible at a glance.** The island must answer "what is it doing right now" without
   reading a word.

## 4. Architecture

Three processes, three languages, one responsibility each. Nothing crosses a boundary it does
not own.

```
                     Rust core (Tauri v2)
                     window management, IPC broker, hotkey, tray
                     |                               |
       stdio NDJSON  |                               |  stdio NDJSON
                     v                               v
        Swift sidecar (perception)        TypeScript core (cognition)
        mic, AEC, VAD, STT, TTS,          router, agent loop, tools,
        screen grab, hand pose, PDF text  permissions, memory, sessions
                     |
                     v
        WebView (presentation)
        island, mind graph, panes, chat
```

### 4.1 Rust core, `apps/desktop`

Tauri v2. Owns every window, the global hotkey, the menu bar item, and the routing of messages
between the webview and the two sidecars. Contains no business logic and no model calls. It is
a broker and a window manager.

Windows it owns:

- **Island panel.** A non-activating `NSPanel` via `tauri-nspanel`, above the menu bar at the top
  centre of the screen the cursor is on, transparent and click-through except where the island
  is drawn, on every Space and over full-screen apps. A stock Tauri window cannot do this and the
  upstream issue remains open; the plugin is the supported path.
- **Mind graph.** A second panel, full-screen, which takes mouse input when open.
- **Main window.** The ordinary application window holding the panes and the chat hub.

Global hotkey via `tauri-plugin-global-shortcut`, which reaches Carbon and needs no permission.
Menu bar via Tauri's tray support.

### 4.2 Swift sidecar, `sidecars/perception`

A SwiftPM executable bundled inside the app, speaking newline-delimited JSON over stdio. It
exists because every hard perception problem on this platform has a first-party answer in Swift
and no good answer anywhere else.

- **Capture.** `AVAudioEngine`, capture only and without voice processing. Apple's hardware echo
  cancellation is one call, but it cannot initialise while the default input and output devices
  disagree on a sample rate, and once it is enabled on the input nothing in the process can start
  playback at all. It is not needed here: the microphone does not pick up these speakers, measured
  with capture left open through a whole reply for no transcripts at all. Kyuren therefore keeps
  listening while it speaks and can be interrupted by being spoken over, with a transcript that
  repeats what was just said discarded in case a louder room ever carries it back.
- **Ducking.** Other audio is quietened while Kyuren speaks, through `AudioDeviceDuck`. There is no
  public equivalent on macOS: the session ducking options are iOS only, and the device volume
  property moves Kyuren's own voice along with everything else. The symbol is exported by CoreAudio
  but not declared in the headers, so it is resolved at run time and its absence costs the feature
  and nothing else.
- **System records.** A short-lived helper answers one question and exits, rather than a fourth
  process being supervised. EventKit reads whatever calendars the Mac already holds, whoever the
  account belongs to, so an account configured once is readable without authorising the service
  behind it a second time.
- **Voice activity.** Silero VAD.
- **Speech to text.** Parakeet streaming via FluidAudio, running on the Neural Engine. Apple's
  `SpeechAnalyzer` and `SpeechTranscriber` are the fallback if FluidAudio disappoints; they cost
  zero application size because the OS manages the models.
- **Text to speech.** Kokoro on the Neural Engine, streamed in sentence chunks so first audio
  arrives before the sentence is finished.
- **Screen.** `ScreenCaptureKit`, single frame on request only. Never a continuous stream.
- **Hand pose.** MediaPipe's palm detector and hand landmark models, converted once to ONNX and
  run through ONNX Runtime inside the sidecar, with the pipeline between them written in plain
  Swift. Nothing about the tracker is Apple specific: the same two model files and the same
  arithmetic run wherever ONNX Runtime does. Apple's Vision hand pose was tried first and
  replaced, because it finds the hand afresh in every frame and answers with a confidence per
  joint rather than one answer to whether a hand is there at all. There is still no Python in
  this project: the conversion is a documented one off, and the models ship as files. Up to two
  hands are followed, each steadied on its own. The first seen aims, with a pinch to take hold,
  a point to read and a fist to change the layer; the other holds: while its index finger is
  raised, the shape of a one, what is lit in the graph stays lit and nothing else is chosen, so
  a dense graph can be read along its links. If the aiming hand leaves, the other takes over
  rather than the cursor dying with a hand still in view.

The sidecar holds every TCC-sensitive capability in one process with one stable code signature,
which is what makes permission grants survive rebuilds.

Routing audio and camera through this process rather than through the webview is also what avoids
Tauri's open `getUserMedia` defects in WKWebView. The webview never requests a media device.

### 4.3 TypeScript core, `sidecars/core`

A Node sidecar speaking newline-delimited JSON over stdio. Owns all cognition.

- **Model access.** Vercel AI SDK 7 as the substrate. It is Apache-2.0, provider-agnostic by
  design, has the best streaming implementation available, ships a tool loop, and threads an
  abort signal into running tools, which is what barge-in needs. A thin internal `Provider`
  interface sits on top only where the SDK's abstraction leaks.
- **Router.** Decides local or cloud per request. See section 5.
- **Agent loop.** Tool dispatch, streaming, interruption, error recovery.
- **Permissions.** See section 7.
- **Memory.** See section 6.
- **Sessions.** Per-pane session stores plus the consolidating chat hub.

### 4.4 WebView, `apps/desktop/ui`

pnpm, Vite, React, TypeScript. Renders the island, the mind graph, the capability panes and the
chat hub. Holds no secrets, makes no network calls of its own, and reaches everything through
Tauri commands and events.

## 5. Model routing

Four drivers, all of them real requirements, not optimisations: latency, privacy, offline
operation, and cost.

Local inventory on this machine, verified present:

| Model | Size | Role |
| --- | --- | --- |
| `qwen3.5:2b` | 2.7 GB | Always resident. Intent classification, routing, short-form work. |
| `qwen3.5:9b` | 6.6 GB | Loaded on demand. Local reasoning when cloud is barred or absent. |
| `nomic-embed-text` | 274 MB | All embeddings. Never leaves the machine. |

The machine has 18 GB of RAM. The 2b model is resident; the 9b model is not, and the router must
account for its load time when choosing.

Routing policy, evaluated in order:

1. **Sensitivity.** Content tagged private by policy (screen captures, message bodies, anything
   under a vault marked private) is local-only. No override from the model, only from the user.
2. **Availability.** No network means local, degraded, and honest about it.
3. **Capability.** Tasks whose quality demonstrably collapses on a small model go to cloud. This
   is measured per task type and recorded, not guessed. The published measurement for this exact
   local model against a frontier model on personal-assistant tasks is a 25 to 39 percentage
   point accuracy gap, so the default assumption is that hard reasoning goes to cloud.
4. **Cost.** Where quality is equivalent, local wins.

Measured on this machine (`docs/MEASUREMENTS.md`, Escalation): the cloud proves ten of ten hard
requests in about four seconds; the large local model four of ten in about a minute; the small
one two of ten. So hard goes to the cloud whenever a key is present, and the large model is the
fallback when sensitivity or being offline forbids it, released two minutes after it answers.

The cloud is Claude Opus 5.5, asked for high effort on every request, since its default is a
level lower than the one the routing was first measured at. A request it declines is retried by
the service on the fallback it recommends for that kind of refusal; one the fallback declines too
is reported as declined rather than as an empty answer.

The user may choose a route for a conversation from under the composer, which also shows what
answered last and how much context it read. A chosen local route always holds. A chosen cloud
route holds only where the policy above would allow the cloud at all: sensitivity and absence
still outrank it, and the answer says why it went elsewhere. Each answer is kept with what
answered it and how much it read, and each conversation keeps its choice, so one opened again
shows both.

Cloud access is by API key. Subscription OAuth works on a personal machine but Anthropic's policy
bars it for distributed products, which makes it unusable for a repository intended to be
published. The repository ships bring-your-own-key.

## 6. Memory

**Source of truth is markdown on disk.** A vault directory of `.md` files with YAML frontmatter.
Human-readable, greppable, git-versionable, and repairable by hand when Kyuren gets something
wrong. This is non-negotiable; it is principle 3.

Connectors, all of which read and write the same graph:

- The native vault, owned by Kyuren.
- One or more Obsidian vaults, read and written as ordinary markdown in place.
- Notion, through its API, as a two-way connector rather than a mirror.

**The index is a cache.** Chunks are keyed by `(path, content hash)`. A file watcher detects
changes, and only chunks whose hash moved are re-embedded. Deleting the entire index and
rebuilding it must always be safe and must never lose information. This is the answer to the
worry about reindexing being fragile: it is fragile only when the index is authoritative, and
here it never is.

Retrieval is hybrid: vector similarity over local embeddings, plus full-text search, plus every
chunk that mentions an entity the question names, fused by reciprocal rank. Entities are found by
how they are written and joined by how they are written: a shorter form joins the one longer form
it sits inside of or stands for by initials, accents and possessives fold away, and a form held by
two names joins neither. So "the same person mentioned in nine notes" is one node with nine
mentions, not nine nodes. Embeddings take no part in that: measured, they put a different person
with the same first name nearer than the same person's initials.

## 7. Permissions

Autonomy inside an allowlist. The gate lives in the TypeScript core, below the model.

- **Allowed silently:** reads, searches, local computation, anything reversible. A read of what
  is hidden in the home folder or kept in its Library, where programs keep keys, tokens and
  histories, or of a file named as a secret anywhere, asks instead, since a secret read is one
  step from leaving. It is judged by the path as written and by the file it opens, so neither a
  link nor a spelling the disk folds together gets past it. A connected vault is read freely, but
  for what is hidden inside it.
- **Requires confirmation:** writes outside the vault, shell execution, outbound actions that
  send, post, pay or delete, and a skill's first call after each approval, whatever its host was
  allowed before, with the question naming the skill. A no there refuses that call alone.
- **Never automated:** credential entry, financial transactions, permanent deletion, and a write
  into Kyuren's own folder outside its vault. That folder holds what the user allowed, which vaults
  may be written, the skills approved and the rules that read unattended, so one yes to a write
  there would grant what only the user grants. Reading there is judged as any hidden folder is.

Decisions are remembered by **action fingerprint**, not by tool name, so approving one shape of
action does not approve a different one wearing the same label. The fingerprint covers the tool,
the target, and the class of effect.

Every gated decision is written to an audit log the user can read in the GUI.

An allow the user gave is kept between runs of the core, in `answers.json` beside the audit, a
plain list of the actions they said yes to that they may edit, so a restart does not ask the same
question again and approving a playbook is allowing it for good. A deny is an answer for now and
is asked again next time: a hasty no should cost a question rather than stand. An answer the
policy would refuse is never taken up from the file, so editing it cannot widen a refusal.

One standing allowance exists, and it is bounded by a run: an approved playbook that names the
web tools may search and read the web for the length of its run without a question per address,
since approving the text that names them is the consent, and every address it read is in the
run's log. The web is read through a hidden window of Kyuren's own, at a search engine the user
may change; a page it reads is given no way to call anything in Kyuren, nor the camera or the
microphone. The reader is never sent to this machine or its network: such an address, or a name
found to lead there, is refused before it is read, a page that redirects or frames one there is
turned back, a page that ends up there all the same hands nothing back, and a page may not fetch
anything for itself from there, its images, scripts and requests included. Where a page ended up is
the reader's to say, as it saw the page load, not the page's. A search engine there is refused when
it is set. Everything the reader fetches goes out through a proxy of Kyuren's own, which looks each
name up itself and connects only to a public address it found, so a name that leads home is refused
for every request a page makes, and cannot answer one way when it is checked and another when it is
connected to. The proxy answers only the reader, which proves itself with a password made for each
launch; WebRTC, which would send past it, is turned off in the reader; a page's requests for this
machine's own addresses, which WebKit sends straight there, are blocked by the reader's rules; and a
PDF's download given no proxy to go through is refused. When that engine refuses a
search with a challenge, or finds nothing, a second engine the user may also change is asked, Bing
by default. Approving a search approves every engine it may reach, so the question names them all.
A PDF is not loaded in that window, which can show one but not hand back its text: the perception
sidecar downloads it, through the same proxy and following a redirect only to the public web, and
reads it with PDFKit, page by page with each page marked, up to 32,000 characters, so research can
cite a paper rather than its abstract.

Once a conversation has read the user's notes, by recalling them, by reading the day, or by
reading inside a vault, anything that would leave the machine is asked about every time, and the
question shows what it would carry: a search's words, a skill's values, a note's text. No earlier
yes and no run's allowance stands in for that question, and its answer is not kept. The mark stays
with the conversation, and passes to a run it starts and back from a run that read notes itself.
On the cloud, what a turn reads goes to the model with its next step, so there a read of the notes
is asked about before it is made; a conversation that holds them asks before a turn goes to the
cloud at all, and stays on this machine if refused; and a judge on the cloud is shown one of them
the run did not write itself only with a yes. Where a question went is written down; what it would
have carried is not.

## 8. Skills

Two kinds of capability:

**Native tools.** Written in TypeScript, reviewed, versioned with the repository. Integrations
with real APIs live here.

**Forged skills.** A skill is a stored request template: name, method, URL template, typed
parameters, header set, auth mode, response mode. The model can author one mid-conversation when
it discovers an endpoint it wants. A forged skill is inert on creation. It appears in the GUI as
pending, the user approves it, and only then does it become callable. This gives Kyuren genuine
self-extension with a human gate, which matches the permission stance rather than fighting it. A
skill reaches only the public web over https, not a name found to lead nearby, and is followed
through a redirect only within the address it was approved for, since anywhere else is somewhere
the approval never looked.

Forged skills appear in the mind graph's capability layer the moment they are drafted, so the
graph shows the assistant growing.

## 9. The island

### 9.1 The icosahedron

A luminous orb rendered in Canvas 2D with no rendering library. It is one drawing,
`apps/desktop/src/mind/core.ts`, for the middle of the mind graph and for the island, so what
stands for Kyuren looks the same summoned and at the centre of its own mind. Layered back to front, all composited
additively so the layers sum into a glow rather than occluding each other:

1. **Glow.** A wide wash through the accent colour to transparent, and a small heart.
2. **Rays.** Radial spokes, each drawn twice, wide and soft under narrow and bright, their
   length modulated by a sine offset per spoke.
3. **Rings.** Two counter-rotating dashed ellipses, vertically compressed so they read as orbital
   rings seen at an angle, turning briskly.
4. **Core.** A rotating wireframe icosahedron, its twelve vertices generated from the golden
   ratio and normalised to the unit sphere, its thirty edges drawn after a hand-rolled rotation
   and a perspective divide. This is the centrepiece and the identity of the thing.
5. **Motes.** Particles born on the rim of the frame that drift outward, slow and fade, read off
   the clock rather than simulated, so nothing is stored and a moment looks the same however it
   was reached.

**Every visual parameter is a function of one scalar**, `level`. The island drives the drawing
with a clock that runs faster as the level rises, which turns the frame, the rings, the sway of
the rays and the spray of motes together, and with a swell that reaches the wash, the rays, the
rings and the motes. This single coupling is what makes the object read as alive rather than as
an animation playing.

This is a clean-room implementation. The geometry (golden-ratio icosahedron), the mathematics
(rotation matrices and perspective projection) and the compositing mode are textbook and not
ownable. No source is copied. The visual language is acknowledged as inspired by the Great Sage
overlay in `izumiishikawa/elfie-assistant`, whose repository carries no valid license grant for
its own code and therefore must not be copied from.

On the island it is the whole drawing, never a reduced one: held at the size of a few letters,
the rays, rings and glow pile up into a blot. It stands in the middle of the voice tab and is
alive whenever it is shown, breathing at rest, swelling with the voice while listening and
speaking, and turning faster while thinking. It is drawn only while the island is open around
it, so a folded island costs nothing to draw.

### 9.2 The island

Kyuren's presence on screen is an island that grows out of the notch, and on a screen without
one out of a short bar at the top centre. It lives on the screen the cursor is on.

**Shape.** Flush with the screen's top edge, rounded at the bottom, with a small concave ear at
each top corner so it flows out of the edge the way the notch does. A solid thin black border the
shade of the notch, nothing beside it, and inside, the main window's glass: dark and painted, a
little lighter in the middle, with the notch's black reaching down into the top of it. The
icosahedron's light is drawn between the glass and the notch's black, clipped to the outline, so
it fades into the notch and never crosses the border.

**Window.** A panel 880 by 320 points, above the menu bar, on every Space and over full-screen
apps. It is ordered on screen once and moved after, since ordering is when macOS pushes a panel
below the menu bar and a later move is not checked. It is click-through everywhere except where
the island is drawn: the host looks at the cursor every frame and decides, because deciding it
over the bridge from the page loses clicks. It has the keyboard while the cursor is on it and
while something in it is being typed into, and gives it back as the cursor leaves with nothing
typed into, and whenever it folds: WebKit sends a page the mouse's moves, and shows a hover, only
in the window with the keyboard, so without it a hover would show nothing until a click. The
panel has it without taking the menu bar or the front from the app the user was in, which has it
back as the island lets go. A click on it does not bring Kyuren forward either: the panel is made
from a window Tauri creates, and macOS takes whether a click activates an app from how a window
was made, not from its style afterwards, so the island sets it as AppKit does for a panel made as
one. Should Kyuren be in front anyway, letting go hands the front back to the app that had it:
resigning alone would leave AppKit holding a key window it no longer treats as one, which the next
hover could not take. A mouse button held leaves the
keyboard where it is, so a drag is never cut off by it moving. The same look at the cursor
watches the mouse buttons and the app in front: a press that starts outside the island, or
another app coming forward, is the island being left. Hidden, it lets the notch take a press only
while a button is already held, which is a drag carried onto it, so a file can be dropped there;
the notch is dead screen, so nothing else is ever pressed on it.

**Modes.** Hidden, inside the notch and drawn not at all; peek, a little wider than the notch,
with a sign beside it when something is waiting; open, 800 by 236, with its tabs. Growing springs
out with a slight overshoot and settles in half a second; folding is firmer and does not
overshoot. Content leaves in 160 ms, and arrives only once the island has grown to within a few
percent of its size, so nothing is seen ahead of the island it belongs in.

**Behaviour.**

- Hovering the notch peeks at once; holding 650 ms, or clicking, opens it. It folds a moment after
  the cursor leaves, 600 ms from a peek and 250 ms open. Something may hold it out while the
  cursor has not yet been to it: a summons by the hotkey or by name, until dismissed; a
  permission question, until answered; a notice, for five seconds. Once the cursor has been on
  it, leaving folds it whatever holds it.
- A click anywhere outside it, or another app coming forward, folds it at once. Kyuren itself
  coming forward is not another app, as when the island brings its own window forward, nor is
  anything coming forward while the cursor is on the island, which the user is using. Folding
  gives the keyboard back and ends a
  summons, so the microphone is never open with nothing on screen to say so; folding to a peek
  ends one as folding away does. While a question waits on the user it folds only as far as the
  peek, its count beside the notch, since whatever asked is stopped until it is answered.
- It opens on a question waiting on the user first; then on the page the user last went to, by its
  tab or within it, or the conversation they started, for two minutes after it folded, so a fold by
  accident costs nothing, with whatever was open within the page, a session or a step, still open
  and paused while folded; then on the page something new happened on
  in the last five minutes, once, so a file dropped on the shelf, a coding agent newly waiting, a
  notice, a pomodoro period run out, an answer that came while it was folded or a shortcut that
  finished is what the next open shows; then on the page chosen in settings, unless something has
  just glanced out of the notch, when a hover opens on what glanced; then on what is waiting, being
  noticed or worked on, then wherever it was last. Escape folds it and ends a summons.
- Its tabs: voice and answers, with a composer across the whole width and, beside the notch,
  what is being done or which model answered, and no name for the page, which its tab already
  says; permission questions, with allow and deny; work in progress, step by step; the coding
  agents running on this Mac; a glance, of widgets switched on in settings; shortcuts, playbooks
  run from the notch; a shelf of files on their way somewhere; and notices. In settings the island is drawn small, its pages beside
  the notch and the glance's widgets below, and both are arranged by dragging them into the order
  wanted or out to a tray of hidden ones; a click shows or hides one. The order is the island's. Each can be switched off in settings, and a tab added since they were last arranged is
  shown, since it was never one hidden. A question
  whose tab is off is left to the main window, which asks every question as well; answered in
  either, it is gone from both.
- The voice tab holds the icosahedron in the middle, above the composer, with what is being
  heard written under it. It appears with a turn once the island has grown, moves away to the
  side when another tab is chosen, and slides back in when the voice tab is chosen again.
- A chat started, typed or spoken, sends the icosahedron up into the notch and shows the
  conversation as message bubbles, each answer streamed into its own. It stays a chat, through
  folding and other tabs, until the hotkey or the name brings the icosahedron back, which starts
  the conversation over. Messages typed in one chat carry one session.

**Glance.** The glance tab holds widgets, each off until switched on in settings, and is a tab
only while one is on. The system widget shows how busy the processor, the GPU, memory and the
startup disk are, as bars; the network widget graphs the last two minutes of upload above a line
and download below it on one scale, the rates now beside it marked with arrows, and under the
cursor draws a line through the moment it points at, with that moment's rates written beside the
line and how long ago it was. The host samples once a second while either is on, with sysinfo for the
processor, memory, disk and network (loopback, VPN tunnels and AirDrop's link left out, since
their traffic is not the Mac's own or is counted on Wi-Fi already) and IOKit for the GPU's own
count of how busy it is, read five times a second and averaged because it changes on every read.
The GPU is read, and the island told, only while the glance is showing.

The pomodoro widget is a focus timer: twenty-five minutes of focus, then a five-minute break, and
after every fourth focus period a fifteen-minute one, each waiting to be started. The host keeps
it by wall-clock time, as a time it ends rather than a count going down, since a clock that stops
while the Mac sleeps would leave the period late by the length of the sleep; it is kept in the
settings file so a running period carries over a restart. A period that runs out glances from
the notch and makes the glance the tab a hover opens; one found run out long ago, through a time
the app was closed, moves on without ringing.

The now-playing widget shows what Spotify or Music is playing: the cover, the track, where it is
with room to seek, play, pause and skip, and the player's own volume, there only under the cursor,
which follows the slider as it moves: each level goes once the one before it has reached the
player, the latest waiting replacing any before it, and the player is read again only once the
slider is let go.
What plays is heard from the players' own broadcasts, which need no permission and never start a
player. Controlling one sends it an Apple Event through osascript, only while it is running, so
the permission macOS asks for the first time comes from Kyuren and waits outside the island;
whether it was given is remembered for each player, as macOS asks for each, and only then is
that player asked for its position and volume, since Music's broadcast does not carry the
position. The broadcasts are asked to be delivered at once, since AppKit otherwise holds them
back while Kyuren is not the app in front. Covers are looked up by the core,
by track id from Spotify's oEmbed and by store id from Apple's lookup, fetched only from the
services' own image hosts and handed to the island as images, since its pages load nothing from
the web.

**Coding agents.** The coding tab lists every session of a coding agent running on this Mac,
however long it has been idle, scrolling past what fits, what waits on the user first: the project, the session's own title, whether it is working, waiting
(and for what) or idle, which harness, and where it was started. The core watches what each
harness leaves on disk, and reads what was said in a session only once the user opens it, or,
for its counts alone, the turn a Claude Code session has just finished. Claude Code keeps one small
file per running session under `~/.claude/sessions`, saying whether it is busy, idle or waiting
and for what; a file is believed only while its process is alive and began when the file says
it did, since process numbers are reused. A turn ended with a command still running behind it is
working, as Claude Code shows it, and the harness's own helper processes are not sessions. Harnesses that keep no such record, Codex, Gemini,
Antigravity and pi, and Claude Code versions before it, are known only by their session files
being written to: lately written is working, less lately idle, long ago not shown. Claude Code's
own transcripts count only while they are being written, and never for a session its record has
shown, since the record says when a session ends and a transcript written at the end does not. Their paths
are taken from the harnesses' documentation and were not run here. An agent newly waiting on the
user glances out of the notch like a notice, counts in the waiting sign, and makes its tab the
one a hover opens. A Claude Code session that comes back to idle after working at least half a
minute glances out too, the peek widening to tell it in a line either side of the notch: whose it
was, then how its tests went, green or red, and how many files it changed, or how long it worked
when there is nothing to count; its row says the same for ten minutes. Only that turn is read for
it, from where the session's transcript stood while it was idle, and only its counts are told;
the event log keeps the session's id alone. Knowing when Cursor, Hermes or OpenCode waits needs hooks installed in each
harness's own configuration, which Kyuren does only with the user's consent.

A Claude Code session opened from the list shows what it is doing: the task it was last given, its
branch, how its tests last went, counted from what the command that ran them printed, a failed run
included, the files it has changed with the lines put in and taken out, its own edits and what its
commands were seen to change alike, and beside them every step it has taken, newest first, with
how each went. A step opens to what it did: a command whole, however long, and the end of what it
printed, all of it on asking, with how it ended and any files it changed, or, left running in the
background, only that it went on there until the harness says how it ended; an edit's change; the
lines a read read; and for work handed to an agent, what the agent was asked and its own steps,
found by the step that started it while it is still working, each of which opens the same way.
The test result opens the run that gave it, and a file the steps that changed it. At the head of
its steps is what the agent itself said last, the question it waits on or how it summed up, three
lines and the rest on a click; its line is found as the transcript is read, without reading what
it says, and read alone when it is shown. A button brings forward the app the session runs in,
Claude's desktop app or an editor, found by climbing from the session's own process, which the
core gives only for a session it knows to be running, to the nearest app above it, and opened
through Launch Services as its icon in the Dock would be, since an app not in front cannot bring
another forward. Claude's documented links start a session but cannot open one already running,
so the app comes forward, not the session within it. This alone
reads a session's transcript: the open session's only, the one written last where a renamed
project left two, read whole once and then only for what is added to it, a megabyte at a time;
each look sends only the steps added or finished since, and a step's own lines are read from where
they lie when it is opened. Nothing read is written anywhere, and what was read goes as another
session is opened. Only the island may ask for it, only Claude Code's sessions open, and the
island, opened afresh rather than back where the user was, shows the list, where a session newly
waiting is.

**Answering from the island.** Claude Code can bring its permission prompts to the island. Switched
on in settings, the only place it can be, Kyuren copies its relay, a small program of its own, to
`~/.kyuren/bin` and adds one `PermissionRequest` hook to `~/.claude/settings.json` beside the
user's own, after keeping a copy of the file in `~/.kyuren/backups`: read whole, changed, its
indentation, ending and permissions kept exactly, and written whole beside it and moved over it; a
settings file that is a link is changed where it lives. A file that does not read as JSON, or that
changes meanwhile, is left as it is, and switching it off takes out only the hook that runs
Kyuren's relay from where Kyuren put it. Claude Code runs the relay as it is about to ask, and
holds its own prompt back while the relay waits. The relay hands the request to the core over a
socket in a folder only this user can open, its length said first and the line kept open while it
waits, so its ending is Claude Code no longer waiting; with Kyuren not running it gives no answer at
once, and Claude Code asks as it would without it.

Only a question the island can show whole comes to it: a command on one line, short enough to read
entire, with no character that could make what is shown differ from what would run, and not one
asking to leave the sandbox; or a file read, an address fetched or a search. An edit's change, a
file's contents and a plugin's arguments are what matter in theirs, and the island does not show
them, so Claude Code asks those itself at once, as it does a plan to approve or a choice to make.
The island opens on the question and says it has it; a question it has not said it has within
three seconds goes back, since no one may be there to answer. Held, it waits at most 45 seconds:
allowed or denied there, Claude Code is told so; asked to ask there, or unanswered in time, the
relay says nothing and Claude Code shows its own prompt. A click within a moment of the questions
changing, or of the island coming into view, is not taken, since it was aimed at what was there
before; an answer that arrives after the question went back is said. Meanwhile its session shows as
waiting for that permission. More than sixteen held at once are handed straight back, a request
too slow to arrive whole is let go, and with the island's questions page switched off a question
goes straight back. What a question would run is kept out of the event log. Other harnesses' hooks
take the same relay, and are added once each can be tried.

**Shelf.** The shelf holds files on their way somewhere, the way a desk holds a pile. Anything
carried onto the notch opens the island on the shelf at once, without the hover's wait, and
dropped there stays exactly where it was: the shelf keeps a place for it, the path it was dropped
from and its disk and number there. The number finds it again however it is renamed or moved on
its disk, and never finds another file put in its place; once the number is gone, what stands at
the path is taken for it, since an app saving a document replaces the file with a new one under
the same name. In a Trash, or deleted, it is let go of; on a disk that is not there now it is
kept, unshown, until the disk returns. Looking for it, and drawing its icon, happen off the main
thread, so a slow disk holds up nothing but the shelf. Dragged out, it is the file itself, so the
Finder, Mail or a messenger takes it as it would from the Finder. The drag offers a move beside a
copy and the place it lands chooses: dropped in a folder on its disk the Finder moves it there, out
of where it was, and to another disk copies it, as it would between folders; a messenger takes a
copy. Option held, at the start or along the way, offers only the copy, so the original stays where
it was. Either way, dropped anywhere but back on the island, it leaves the shelf. Taking one off
only lets go of it, wherever it is.

Files that went onto the shelf before it kept places instead live on it still, each in a folder of
its own in `~/.kyuren/shelf`: dragged out to a folder they are moved there, and they leave once
moved out; taken off, the shelf's own copy goes to the Trash, since it may be the only one.
Something already on the shelf, dragged out and back, is left as it is; a folder holding the
shelf, or a whole disk, is refused, known by what it is rather than how its path is spelled. What
is kept is what the window itself reports dropped, never a path the page names, and what is
dragged out is found by its name on the shelf alone. Each shows its Finder icon, drawn once by
AppKit at twice its size and kept beside the shelf. With the shelf switched off, the notch takes
no drop and nothing dropped on the island is kept.

**Shortcuts.** Playbooks chosen in settings, among the approved ones under playbooks, are keys on
the shortcuts page, which is a page only while one is chosen. One that needs nothing runs at a
press; one that needs a word asks for it in a box at the foot like the chat's, in the playbook's
own words for its first input, the rest found from the words and the day as a slash command finds
them; one that needs more answers than that is for the chat, and says so. One runs at a time, kept
as a conversation in the chat page like a slash command, and what it came to shows under the keys.
A run that ends while the island is folded is what its next open shows.

The behaviour was shaped after Louis Raillé's coucou, a notch island published under MIT, whose
specification and feel it follows. No source is copied, and its character and artwork, which are
reserved, are not used.

### 9.3 State protocol

The icosahedron listens on two channels. Independence matters for the island as it did for the
orb: listening while a tool runs is a real combination, and a single enum cannot express it.

| Channel | Event | Type | Meaning |
| --- | --- | --- | --- |
| `energy` | `orb:energy` | `0..1` | Live microphone amplitude while listening, smoothed toward the target. |
| `state` | `orb:state` | `idle \| listening \| thinking \| speaking` | What Kyuren is doing; it sets how fast it turns and how far it swells. |

The island also listens for `island:screen` (the notch it is under), `island:hover`,
`island:summon` and `island:dismiss`, `island:tabs`, and for what it shows: `transcript`,
`agent:text`, `agent:reply`, `agent:route`, `permission` and `permission:answered`,
`presence:notice`, and `mind:step` and `mind:step-done`. Transport is Tauri events. Icons are drawn
as vector paths, never as emoji or icon fonts, because font fallback differs between webviews and
produces missing-glyph boxes.

### 9.4 Palette

Catppuccin Mocha, with lavender as the accent. It governs every surface: the island, the
icosahedron, the mind graph, the panes and the chat hub all draw from these tokens.

| Token | Value | Use |
| --- | --- | --- |
| `base` | `#1e1e2e` | Window ground. |
| `mantle` | `#181825` | Raised panels and rows. |
| `surface0` | `#313244` | Borders and dividers. |
| `text` | `#cdd6f4` | Primary text. |
| `overlay2` | `#9399b2` | Labels and secondary text. |
| `lavender` | `#b4befe` | The accent. Periwinkle. Kyuren's identity colour. |
| `blue` | `#89b4fa` | Secondary accent, outer halo and the orb wireframe's under-glow. |
| `pink` | `#f5c2e7` | The orb's inner core. |
| `maroon` | `#eba0ac` | The inner core's falloff. |
| `sky` | `#89dceb` | Inner orbital ring. |
| `sapphire` | `#74c7ec` | Outer orbital ring. |
| `green` | `#a6e3a1` | Healthy state. The only green in the system. |
| `red` | `#f38ba8` | Failed state. |

Green is reserved for indicating health and is never decorative, with one exception the user
asked for: a diff shows lines put in green and lines taken out red, as every diff does.

The orb is deliberately split warm against cool: the core runs white through pink into maroon,
while everything around it, the halo, the wireframe and the rays, stays on the periwinkle side.
The white centre is not decoration. Without it the pink has nothing to glow against and reads as
a flat wash rather than as light.

## 10. Licensing of dependencies

Because this repository will be published:

- **Permitted:** Apache-2.0, MIT, BSD, ISC, CC-BY, and Unicode 3.0. The Mozilla Public Licence 2.0
  is permitted for the few crates Tauri brings with it (`cssparser`, `cssparser-macros`,
  `selectors`, `dtoa-short`, `option-ext`): it binds changes to those files only, and none is
  changed.
- **Excluded:** GPL in any form, and any model weight carrying a non-commercial clause.
- **Exceptions, recorded by the owner:**
  - The streaming speech model FluidAudio downloads at run time, Parakeet realtime end of
    utterance, is under the NVIDIA Open Model License, which allows commercial use but is not an
    open source licence. It is not in the repository.
  - The wake word training tools in `tools/wakeword` install GPL and LGPL Python packages, as
    dependencies of the speech synthesiser, on the machine that trains. They are never part of
    Kyuren or anything it ships, and the pronunciation is given as IPA so that the GPL espeak-ng
    fallback is never used.

What is redistributed here, and under what terms, is listed in `THIRD_PARTY_NOTICES.md`.

Specific traps already identified and ruled out:

- `piper1-gpl` is GPL-3.0. Excluded. Kokoro is Apache-2.0 in both code and weights.
- openWakeWord's pre-trained models are CC BY-NC-SA. If a wake word ships, the model is trained
  in-house. The library itself is Apache-2.0 and acceptable, and so are the two feature models in
  front of the wake word, Google's speech embedding and a fixed mel spectrogram, for the reasons
  recorded beside them in `SOURCE.md`.
- XTTS-v2 weights are non-commercial and their license URL no longer resolves. Excluded.
- Porcupine's free tier was terminated in June 2026 and existing free keys were disabled. Not an
  option regardless of license.
- `izumiishikawa/elfie-assistant` carries Expo's scaffold LICENSE naming a third party, not the
  author. Its code is effectively unlicensed. Reference only, never copy.

## 11. Signing and permissions

Grants for microphone, Accessibility and Screen Recording bind to a code signature. An unstable
signature means macOS re-prompts on every rebuild, which makes the development loop unusable.

A signing identity is therefore established in stage 0, before any code that touches a permission.
All privileged capability lives in the Swift sidecar so that a single stable signature covers
every grant, and the app requests each permission at the moment it is first genuinely needed
rather than at launch.

The signing identity is supplied through `APPLE_SIGNING_IDENTITY` in the environment rather than
committed, because the identity string carries a personal Apple ID and this repository is intended
to be published. See `.env.example`.

`tauri dev` runs a raw unsigned binary rather than the application bundle, so it carries no stable
signature and no entitlements. Any work that touches a permission therefore runs against the
bundle, built and launched with `pnpm run:bundle`. Day to day interface work can stay on
`pnpm dev`.

What makes grants survive a rebuild is that the designated requirement derives from the bundle
identifier and the signing certificate rather than from the code hash. A rebuild changes the code
hash and leaves the designated requirement untouched, and TCC matches on the latter.

Screen Recording carries a recurring re-consent prompt on macOS 26 that cannot be suppressed
without a managed entitlement. This is the reason screen capture is on demand only. A continuous
screen watcher would nag forever.

## 12. Conventions

Carried over from the Kyuren house style and binding here.

- Comments default to none. The code explains itself. Where a comment is genuinely required it is
  one or two lines explaining **why**, never what. No filler, no restating the signature.
- No em-dash anywhere, in code, comments, documentation or commit messages.
- No emojis anywhere.
- Never use relative imports across modules. Use the configured aliases.
- No references to roadmap stages or plan artifacts in code, comments, commits or documentation.
  Citations of external sources are welcome; references to our own planning are not.
- Verify before claiming done. Run it. A passing type check is not evidence that a feature works.
- Any change to the core pipeline or the architecture ships with a test that locks the invariant
  it establishes.
- The island's behaviour is held by end-to-end tests run in WebKit, the engine its webview is,
  through its own preview harness: `pnpm e2e`. A change to how the island behaves runs them, and
  one that adds behaviour adds to them. The main window has no harness; its tests there stand in
  for Tauri's own channel instead.
- Many small focused files over few large ones. The reference repository's 2,498-line single-class
  daemon is the specific failure mode being avoided.
- Conventional commit messages.

### Vaults and what may be done to them

A connected folder carries one of three settings. `read` refuses writes outright, so a vault kept
by hand stays that way whatever has been approved before. `ask` puts each write to the user, for
notes with conventions worth following and consequences worth seeing. `write` is Kyuren's own
vault, where the days it writes are kept.

A folder connected from elsewhere is `read` until the user says otherwise: connecting someone's
notes is not the same as handing them over. A Notion database carries the same three settings and
is addressed the same way, so one rule decides where any write may land, on this machine or not.
Sharing a database with the integration says it may be read; writing to it is a separate thing to
be told.

Rules written inside a vault are followed as instructions and never treated as permission. A note
saying Kyuren may write somewhere grants nothing, because anything able to put text in a vault
could otherwise grant itself access to it. Where a write may land is settings; how to write it is
the note's to say.

## 13. Playbooks

Kyuren does its tasks by playbook: one written procedure per kind of task, kept as markdown
under `~/.kyuren/playbooks/`, beside the vault rather than in it, so that a procedure is never
remembered as a note, while staying readable, versioned by git and repairable by hand. The playbook is the unit of getting better. When a run goes wrong the playbook changes,
not the model.

A playbook holds:

- **Frontmatter.** `name`, a few lowercase words joined by dashes, since it is also the name of its
  file and of its runs' folder; `when`, the requests it is for, in plain words the router matches
  against; `inputs`; `skills`, the capabilities it draws on; `version`; `author`, the model and
  the date; `approved`, by whom and when.
- **Steps.** What to do, in order, written for the model that will run them.
- **Proof.** A numbered list of what done looks like. Every item is checked at the end of a run,
  and most must be checkable by machine: a file exists, a command exits zero, a request returns a
  value, a pattern appears in the output. Only what cannot be measured falls to a rubric the model
  judges, and a playbook whose proof is all rubric is not approved, because that is a proof the
  model can talk itself past. A command runs in a plain POSIX shell and is given the run's inputs
  as values, never as more of the command, and never inside a substitution, so an input cannot
  turn an approved check into something else.
- **Notes.** Short lessons from past runs, added by repairs.

**Skills** are the reusable half. Section 8's two kinds stay and a third joins them: procedure
skills, markdown instructions a playbook names and a run loads when it does. Native tools,
request skills and procedure skills are the toolset every playbook draws from; nothing is written
into a playbook that a skill could do for all of them. Playbooks and their skills appear in the
capability layer of the mind, as everything Kyuren can do must.

**Runs.** Every run of a playbook writes one markdown file under `~/.kyuren/runs/<playbook>/`: its inputs,
the route and model, each tool call with the gate's decision and whether the question was put,
each proof item's result, time and cost, and a closing note on what went wrong. A run the model
gave up on part way is written down as well, as failed, with the calls it had already made, and a
parent's proof points at that log. Runs are what a repair reads. The session store keeps the
conversation; the run log keeps the work.

**Schedules.** A playbook can run at a time of day, on the days named, without being asked, by
a `schedules` entry in the ambient rules file beside the rules that let Kyuren speak up. Writing
one there is the permission to run that playbook unattended, as naming a source is the permission
to read it. The run is a run like any other, logged under runs and kept as a conversation in the
pane the entry names, and it is written into the presence log as a firing of its schedule, so the
log shows the running as it shows the noticing. Nobody is at the keyboard, so a question the run
would have asked is refused and the refusal is in its log; a schedule starts its own playbook and
nothing else. A time the machine slept through is honoured for half an hour and then let go.

**Sub-runs.** A step may run other approved playbooks, several at once, a handful at a time
through the pool that runs repositories, each with its own log. The parent is told of each and
its proof includes theirs, so a parent whose child failed has failed.

**Deep research.** Two playbooks on the above. `deep-research` breaks a question into
sub-questions, runs `research` on each as sub-runs, writes a report whose every claim of fact
ends in a numbered inline citation that is a link, with a source list at the end where each
entry is graded for credibility with the reason, then runs `fact-check` as a sub-run in a fresh
context, which reads every cited page again and writes down, claim by claim, whether the page
supports it, and revises the report by what it found. The proof holds the shape: every inline
number is its numbered source at the same address (`numbered`), every source was read in the
run or a sub-run (`cited`), no unsupported marker remains (`lacks`), and the check file exists.
What a page supports and how credible it is stay the model's judgement, made twice and written
down, never the proof's. Links in the window open in the user's own browser, never in the window.

**Who writes them.** Playbooks and procedure skills are authored and repaired only by a frontier
model, through the cloud route or a Claude Code session, never by the local models, which only
run them. An authored or repaired playbook is inert until approved: it appears as pending with
its diff and the run that prompted it, and approval is of that text, as with request skills. A
playbook is an instruction the model will follow with real tools, so a page read during a run
must never be able to rewrite one.

**Why this shape.** Procedures improve without touching weights. A proof makes a run's success a
fact rather than an impression. A run log makes a failure legible. The approval gate keeps
self-improvement inside the permission stance of section 7.

## 14. Open decisions

1. **Cross-platform support.** Currently macOS only, and the architecture leans on that: the
   Swift sidecar delivers Neural Engine inference for speech, which has no equivalent elsewhere,
   and captures the camera and screen through Apple frameworks. Hand tracking is deliberately
   not on that list any more: it was moved off Apple's Vision framework onto MediaPipe's models
   through ONNX Runtime so that it adds nothing platform specific. Supporting Windows or Linux
   later means either a parallel perception sidecar per platform for capture and speech, or
   giving up the Neural Engine. Recorded as an open decision because it was not explicitly
   ruled out, with macOS-only as the working assumption until overruled.
2. **Wake word.** Settled. "Hey Kyuren" ships on an in-house trained head over Apache-2.0
   feature models, as an opt-in that can be switched off, and off means the microphone is
   closed. While it is on, the microphone indicator is permanent, which is the cost accepted.
3. **Escalating to the larger local model.** Settled by measurement on 2026-09-18, recorded in
   `docs/MEASUREMENTS.md`: on ten hard requests the cloud proved ten, the large local model
   four and the small one two. The cloud takes the hard tier whenever a key is present. Forced
   local, the large model stays, at about a minute a question, and is released two minutes after
   it answers so the memory goes back to listening.
