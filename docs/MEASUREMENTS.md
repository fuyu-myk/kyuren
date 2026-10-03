# Measurements

Numbers taken on the development machine, recorded so that a regression is visible rather than
felt. Each entry names what was measured, how, and on what.

Machine: Apple M3 Pro, 18 GB, macOS 26.6.2.

## Audio capture

Taken 2026-09-14 against `kyuren-perception` driven directly over stdio.

| What | Value | How |
| --- | --- | --- |
| Input format after voice processing | 48 kHz, 9 channels, Float32 | `AVAudioInputNode.outputFormat` |
| Buffer cadence | roughly 8 per second | counted `audio.level` events over 5 s |
| Room tone | median 0.066, max 0.077 | 5 s of a quiet room |
| Speaker playback while capturing | median 0.060, max 0.080 | 8 s with speech playing aloud |

The requested tap buffer of 1024 frames is ignored by the system, which delivers roughly 4800
frames instead. Anything needing finer granularity has to re-chunk rather than assume.

The device reports nine channels once voice processing is enabled, and every channel carries
identical content. Level is read from the first.

**Echo cancellation is confirmed working.** Speech played through the speakers produced no
measurable rise over room tone, which is the point of `setVoiceProcessingEnabled`. Tested on
speakers rather than headphones, since headphones would pass the test trivially.

## Voice activity

FluidAudio's FSMN voice activity model, taken 2026-09-14 against `kyuren-perception` over stdio.

| What | Value | How |
| --- | --- | --- |
| Model load, first run | under 45 s including download | `vad.loading` to `vad.ready` |
| Decision cadence | 256 ms | 4096 samples at 16 kHz, fixed by the model |
| False positives, quiet room | 0 segments in 32 s | default threshold of 0.85 |

The roadmap names Silero. The model here is FSMN, reached through FluidAudio, which implements
Silero-compatible streaming semantics (hysteresis, minimum speech and silence durations, speech
padding). It was chosen because it arrives ANE-accelerated in the same Apache-2.0 package that
will supply transcription and synthesis, rather than requiring a separate ONNX runtime.

Two consequences of the 256 ms decision cadence. Speech onset cannot be detected faster than that,
so the speech-onset budget has a floor it did not have on paper. And the microphone's 100 ms
buffers do not divide into it, so the stream re-chunks rather than mapping buffers to decisions.

## Transcription

FluidAudio's Parakeet EOU 120M streaming recogniser on the Neural Engine.

| What | Value | How |
| --- | --- | --- |
| Variant | `parakeetEou320ms` | was `parakeetEou160ms` |
| First partial after speech start | 928 ms, one sample only | `sinceSpeechStartMs` on `transcript.partial` |

The 160 ms variant was chosen first for latency and swapped out for accuracy. It confused
phonetically similar words often enough to be distracting, which is expected of a 120M acoustic
model, and its latency advantage was not showing up in practice: the single first-partial sample
taken against it was already well over the 400 ms budget.

**The latency figure is one observation of a one-word utterance and should not be trusted.** It
cannot be measured without a person speaking, because echo cancellation works well enough that
speech played through the speakers never reaches the microphone.

Audio is fed to the recogniser continuously rather than gated on voice activity. Voice activity is
decided 256 ms late, so gating on it would clip the opening of every utterance. Voice activity
decides only when an utterance has ended.

## Speech synthesis

Kokoro 82M through FluidAudio on the Neural Engine, taken 2026-09-14 against `kyuren-perception`
over stdio. Latency is wall clock from the request to the first audio buffer being queued.

### Compute unit routing matters more than anything else

FluidAudio routes the noise and tail stages to the GPU by default on this OS line, because those
graphs are fp32 and the fp16 Neural Engine cannot take them. On this machine that choice is bad:

| Routing | Acoustic stage, four consecutive calls |
| --- | --- |
| `default` | 250, 1007, 115, 945 ms |
| `cpuAndGpu` | 1779, 2379, 1504, 1539 ms |
| `allAne` | 87, 99, 89, 89 ms |

The default is not merely slower, it is **bimodal**, which is the signature of the GPU stages
failing and falling back. FluidAudio's own source notes GPU stages aborting intermittently inside
MPSGraph under CoreML on the newer OS line.

Output was checked before adopting the faster routing: identical text produced **82,200 samples on
both paths with RMS agreeing to 0.1%**, which is fp16 rounding rather than degraded audio.

### Latency after the fix

| What | Value | How |
| --- | --- | --- |
| First audio, warm | 125, 140, 139 ms | `firstAudioMs` on `voice.started` |
| Acoustic stages | roughly 90 ms | `acousticMs` |
| Text frontend, warm | roughly 40 ms | `frontendMs` |
| Text frontend, first call | roughly 1100 ms | one-off grapheme-to-phoneme warmup |
| Cost against text length | flat | 6 characters cost 1079 ms, 98 characters 1137 ms, before the routing fix |

**This clears the 300 ms budget for first audio.** Synthesis cost is flat in text length, so
splitting a reply into sentences does not buy first-audio latency. It is still done, because it
lets playback start while later sentences are generated.

### Barge-in

Voice activity decides 256 ms late, which is slower than the 200 ms barge-in budget allows. The
interrupt therefore triggers on signal level from the resampled stream, roughly every 100 ms.
Echo cancellation has already removed Kyuren's own output, so anything loud enough is the user.

## Echo cancellation and other audio

Voice processing lowers all other system audio for as long as it is enabled. The ducking level is
adjustable (`default` is 0, `min` 10, `mid` 20) and can be changed on a running engine, but even
`min` is audible, so the setting cannot solve it. Voice processing is therefore enabled only while
Kyuren is speaking, which is the only time its own output can reach the microphone.

| What | Value | How |
| --- | --- | --- |
| Cost of switching voice processing | 550 to 730 ms of dead capture | measured across repeated toggles |
| Input while listening | 44.1 kHz, 3 channels | voice processing off |
| Input while speaking | 48 kHz, 9 channels | voice processing on |
| Room tone, voice processing off | -29.9 dBFS median, -27.6 max | was -40 dBFS with it on |

Voice processing suppresses noise as well as cancelling echo, so the same room measures **louder**
without it. The level curve was retuned for the unprocessed input it now sees while listening
(quiet -34 dBFS, loud -6, knee 1.9), which brings room tone back to a median of 0.024 against the
0.23 the old curve gave.

A measurement taken while the built application was also running reported a room tone of 0.000 and
a one-channel device. That was contention over the input device, not a real reading. Measure
against the sidecar alone.

Enabling is immediate. The dead window it costs happens to cover the period before cancellation is
active, when Kyuren's own voice would otherwise register as the user interrupting. Disabling is
delayed by 1.5 s so the gap lands in silence rather than clipping the start of a reply.

## A recorded session of real speech

Ten utterances spoken into the perception sidecar directly, 2026-09-14, with the application
stopped so nothing contended for the microphone.

### First partial after speech start

992, 522, 514, 831, 414, 623, 825, 308, 221, 897 ms. **Median 623 ms, two of ten inside the
400 ms budget.**

This does not meet the gate. The measurement is also optimistic: it starts when voice activity
reports speech, which is itself up to 256 ms after the speech actually began, so true onset to
first partial is closer to 880 ms.

Two floors are stacked underneath it. Voice activity decides on 256 ms chunks, and the
`parakeetEou320ms` recogniser emits on 320 ms chunks. Their sum alone is most of the budget.

### Levels of that voice

| Quantile | Level under the old curve | Implied dBFS |
| --- | --- | --- |
| p50 | 0.061 | -30.2, room tone |
| p90 | 0.155 | -26.6 |
| p97 | 0.316 | -21.7 |
| p99 | 0.469 | -17.7 |
| max | 0.530 | -16.2 |

The loudest speech in the session reached only -16 dBFS, so the -6 dBFS ceiling was wasting a
third of the range and the orb never approached its upper scale. The curve now runs -32 to -14,
which puts room tone at 0.040 and the loudest speech at 0.833.

### Transcription accuracy

Three of ten were clean, four had one or two wrong words, three were badly garbled. The failures
were not evenly distributed: short, quiet or fast utterances fared worst. Moving from the 160 ms
variant to 320 ms did not resolve this, which suggests the limit is the 120M acoustic model rather
than the chunk size.

## Two-tier transcription

The streaming recogniser answers before a sentence is over, which is why it is 120M parameters and
why it garbles short, quiet or fast speech. Once an utterance ends its audio is complete, so the
final transcript is produced again by an offline 0.6B model and the streaming result is kept only
as a fallback.

Whisper was considered and rejected. `whisper-small` is 244M against the 600M already available,
measures worse on published benchmarks (roughly 12.8% against 6.3% word error rate, third-party
figures), cannot stream at all because it consumes fixed thirty second windows, and would require
an ONNX runtime beside the existing Neural Engine path.

Loading the offline model is detached. An earlier version awaited it inside the audio loop, which
blocked transcription, voice activity and barge-in for the entire first download.

Utterance audio is buffered with 750 ms of pre-roll, because voice activity reports speech after it
has already begun and the opening word would otherwise be missing from the refined pass.

### Validated against real speech

Eight utterances, 2026-09-14, same audio through both models.

| Fast 120M, streaming | Offline 0.6B |
| --- | --- |
| why are you being scheduled today | Do I have anything scheduled today? |
| mark simon is complete | Mark assignment one as complete |
| schedule a meeting for seven on monday | Schedule a meeting for 7 on Monday |
| what are my appending assignments | What are my appending assignments |

Two of eight were unintelligible from the streaming model and correct from the offline one. Five
gained punctuation, capitalisation and numerals. One error survived both, so the second pass is not
a cure for everything.

**The second pass costs a median of 163 ms, maximum 205 ms.** That is far cheaper than expected and
runs after speech has ended, when nobody is waiting on a partial.

Levels over the same session against the refitted curve: room tone 0.016, p97 0.366, peak 0.836.
The curve was fitted to a previous session and predicted a peak near 0.83, so it holds.

First partial in this session ran to a median of 819 ms against 623 ms previously, on eight
samples. Both are well over the 400 ms budget and the variance between sessions is larger than any
tuning would recover. The budget needs restating against the two chunk floors rather than chased.

## Model routing

Taken 2026-09-14 against the cognition sidecar over stdio, no cloud credentials present.

| What | Value |
| --- | --- |
| `qwen3.5:2b`, cold | 23.5 s for a one-word reply |
| `qwen3.5:2b`, warm | 3.2 s for a one-word reply |
| Ollama keep-alive | about 5 minutes, then the model unloads |
| Default context allocated | 131072 tokens, 4.3 GB resident on the GPU |

The cold figure is the model loading, not inference. It matters because Ollama unloads after a few
idle minutes, so the first request after a pause pays it. Anything that wants to feel instant has
to keep the small model resident rather than assume warm timings.

Three seconds for a single word from a 2B model is still slow, and the 131072 token context Ollama
allocates by default is the first thing to look at.

The cloud route cannot be exercised yet: no API key, no `ANTHROPIC_AUTH_TOKEN`, and no `ant` profile
on this machine. The router handles that explicitly rather than failing, and the behaviour is
covered by tests.

## Escalation

Taken 2026-09-18 with `tools/escalation/measure.ts`: ten hard requests with proofs a machine can
check, each run once on each route through the core's own provider code, the local models
unloaded first so the load counts. Output was capped at 1500 tokens; a thinking model that spends
the cap before answering is recorded as a miss, which happened to the cloud once, on the calendar
task, and to the local models on several. Re-run with a 6000 token budget the cloud answered the
calendar task correctly in 14 s, so its true score is ten of ten. The cloud alone was measured
again on 2026-10-01 when it moved to Claude Opus 5.5, with a 6000 token budget and the high
effort the application asks for: ten of ten, a little faster than before.

| Route | Model | Proved | Mean | Slowest | Load |
| --- | --- | --- | --- | --- | --- |
| cloud | claude-opus-5 | 9 of 10, 10 with a larger budget | 5.3 s | 17.7 s | none |
| cloud, 2026-10-01 | claude-opus-5-5, high effort | 10 of 10 | 4.1 s | 10.0 s | none |
| local-large | qwen3.5:9b | 4 of 10 | 62.4 s | 86.1 s | 9.3 s |
| local-small | qwen3.5:2b | 2 of 10 | 29.7 s | 33.4 s | 2.8 s |

What the local models got right was the two retrieval-shaped tasks, reading an answer out of
given notes and applying a stated rule; the large one also managed the arithmetic and the logic
puzzle. Neither produced the schedule as JSON, working code, or the complexity. The decision:
hard goes to the cloud whenever a key is present. Forced local, by sensitivity or by being
offline, the large model is kept, since it gets twice what the small one does on hard work, at a
minute a question, and it is now let go two minutes after answering rather than thirty, because
while it is resident the audio device cannot start (see the section on playback below).

## Agent loop

Taken 2026-09-15 against the cognition sidecar, no cloud credentials, so everything ran locally.

| What | Value |
| --- | --- |
| Two-step tool task on `qwen3.5:9b` | 14.7 s |
| Steps taken | 2, one tool call and one reply |

The first attempt at the same task is worth recording. Asked only to *list* a directory, the local
model called `write_file` against `/tmp/output.txt`. The gate intercepted it, asked, and the run
blocked rather than writing. Adding "do not write any files" to the prompt produced the correct
`list_directory` call.

That is the permission gate earning its place on its first real outing, against a model that is
merely careless rather than adversarial. It is also a caution about local tool selection: a 9B
model picks the wrong tool readily, so the gate is load-bearing rather than ceremonial.

Reads are allowed by policy, so a correct run asks nothing and the user is not trained to approve
by reflex.

## Speech synthesis, cold paths

A reply spoken after a period of quiet is much slower than the warm figures above suggest, and the
difference is in two separate warm-ups.

| What | Cost |
| --- | --- |
| Loading the model into the Neural Engine | about 24 s |
| First synthesis after loading | about 2.3 s, an ANE compile |
| A synthesis 15 s after the last one | about 1.1 s |
| Back-to-back syntheses | 125 to 140 ms |

Loading is now started when listening begins rather than when a reply is needed, and the warm-up
runs one throwaway phrase whose audio is discarded, because loading the model does not warm the
inference path.

The engine still goes cold within roughly fifteen seconds of idleness, so the first reply of a
conversation costs about a second. That is small beside the fifteen to thirty seconds the local
model takes to think, so it is left alone rather than kept warm by busy work.

Two faults were found while measuring this. Playback errors were swallowed by a `try?`, so a failed
`enqueue` produced silence and no event at all. And the model was being loaded twice concurrently,
once by the warm-up and once by the first reply, because the check for an existing manager was not
single flight.

## Playback cannot share the capture engine

Reported as: the assistant answered, other audio ducked, and nothing was spoken.

`AVAudioEngine` configurations tested directly:

| Configuration | Result |
| --- | --- |
| Voice processing off, player node on the capture engine | works |
| Voice processing on, player node on the capture engine | fails, `-10875` on `outputNode` initialise |
| Voice processing on, player node on a second engine | fails, `'what'` on `kAUStartIO` |
| Voice processing on, playback through `AVAudioPlayer` | **works** |

Format and attachment order make no difference to the failures; the first three fail on this machine
regardless. Playback therefore does not go through `AVAudioEngine` at all. Kokoro's samples are
wrapped as WAV and played by `AVAudioPlayer`, which is the only path that coexists with echo
cancellation.

Echo cancellation still does its job on that path. Measured across one long spoken sentence:

| | Median | Max |
| --- | --- | --- |
| Room tone before speaking | 0.045 | 0.124 |
| While Kyuren is speaking | 0.000 | 0.000 |

Kyuren does not hear itself at all, so a level above the threshold during playback is the user and
barge-in stays viable.

Two further faults surfaced here. Playback errors were being swallowed by `try?`, which is why the
original symptom was silence with no event. And `AVAudioPlayer` delivers completion on a run loop,
so with the main thread blocked reading standard input a clip played but never reported finishing;
requests are now read on their own thread.

## Spoken replies and markdown

Reported as: the orb stuck on speaking with other audio ducked, and no speech.

Local models answer in markdown whether asked to or not. Kokoro's grapheme-to-phoneme stage fails
on some of it, and the failure was being skipped with a bare `continue`. When the failure landed on
the **last** sentence, the completion callback was never registered, so the utterance never
reported finishing, the orb stayed on speaking, and echo cancellation was never released, which is
what kept other audio ducked.

Two fixes, because either alone would have left a sharp edge:

1. Markup is stripped before synthesis. Emphasis, headings, bullets, numbered items, links, inline
   code, tables and rules are reduced to their words; fenced code is dropped entirely. A reply that
   is nothing but markup reports that there was nothing to speak rather than reading punctuation.
2. Speaking now settles when synthesis has stopped producing and the queue has drained, whichever
   is last, rather than depending on one nominated sentence succeeding.

The agent is also asked for prose rather than a document, since a reply that is read aloud should
not have been markdown to begin with. The stripping is the backstop, not the plan.

## Orb energy while speaking

One reply of two sentences, spoken through the release sidecar over stdio.

| | |
| --- | --- |
| playback | 4.71 s |
| level readings | 142 |
| rate | 30.1 per second |
| peak reading | 0.78 |
| mean reading | 0.16 |
| readings above 0.3 | 25% |

Synthesised speech peaks at about -17 dBFS against the -16 dBFS measured for this voice through
the microphone, so the listening curve carries over unchanged and no separate mapping is needed.

Before the in-flight step count was added, a clip was invisible between leaving the queue and its
player being built. `voice.finished` landed in that window and ended the reply at 0.00 s of audio,
reproducibly, with 1 level reading. That window is microseconds wide but is hit whenever synthesis
finishes ahead of the first playback step, which is the normal case on the Neural Engine.

## Echo cancellation

Not usable on this machine, so Kyuren is half duplex.

The default input runs at 48000 Hz and the default output at 44100 Hz. Voice processing needs one
rate for both, so `kAUInitialize` on the output node fails with `-10875`. Enabling it on the input
alone succeeds, but then nothing in the process can start playback: `AVAudioPlayer.play()` returns
false and an engine output fails `kAUStartIO` with `'what'` (2003329396).

Tried, all failing the same way:

| attempt | result |
| --- | --- |
| separate `AVAudioPlayer` alongside a voice-processing capture engine | `play()` returns false |
| `AVAudioPlayerNode` on the same engine | `-10875` on `kAUInitialize` |
| voice processing on the output node as well | `-10875` |
| both devices set to 48000 Hz first | `-10875`, `mainMixerNode` still comes up at 44100 |

With voice processing off, the same reply plays correctly while the microphone is live: 154 ms to
first audio, 3.2 s of playback, 112 level readings.

An earlier note recorded echo cancellation as verified because the microphone read 0.000 while
Kyuren spoke. That reading was silence for the wrong reason. Nothing was playing.

## Optimisation level of the perception sidecar

The application ran the debug Swift build. One reply, same machine, same text:

| build | synthesis | first audio |
| --- | --- | --- |
| debug | 3118 ms | 4761 ms |
| release | 127 ms | 166 ms |

Roughly twenty five times, which is what the assistant taking minutes to answer actually was. The
application now runs the release build and the bundle step builds it.

## Starting a clip

`AVAudioPlayer.play()` intermittently returned false. It correlates with load, not with any build
or configuration: every failing run measured 785 ms or more of synthesis, every passing run around
120 ms. Calling `play()` without `prepareToPlay()` first makes acquiring the output device part of
the start, and that is the part that fails while the machine is busy.

Preparing first, and treating a refusal as a device that is momentarily busy rather than as a reply
that cannot be spoken, holds under the load that reproduced it: three sidecars with live
microphones synthesising and playing at once, all three played in full.

## Why replies took minutes and audio would not start

Both had one cause. The machine was at six percent free memory with 16.3 GB of 17.4 GB swap in
use, and every spoken turn routed to qwen3.5:9b, which holds about 10 GB resident.

Speaking one reply, three attempts each, nothing else changed:

| state | outcome |
| --- | --- |
| qwen3.5:9b resident | 3 of 3 refused to start, 2 level readings each |
| no model resident | 3 of 3 played in full, 108 to 113 readings |
| qwen3.5:2b resident | 3 of 3 played in full, 109 to 113 readings |

A real-time audio thread cannot take page faults, so starting an output stream fails outright
rather than running late. The same pressure is what made replies erratic: with the 9b resident the
identical question answered in 8.8 s, 51.3 s and 54.8 s on consecutive runs, depending on whether
the weights were still in physical memory.

Reply latency for one greeting, model already resident:

| | |
| --- | --- |
| qwen3.5:9b, reasoning on | 23.5 s, 329 completion tokens |
| qwen3.5:9b, reasoning off | 13.5 s, 207 tokens |
| qwen3.5:2b, reasoning on | 14.4 s, 602 tokens |
| qwen3.5:2b, reasoning off | 8.0 s, 346 tokens |

The visible answer is eight tokens in every case. Spoken turns therefore ask for no reasoning
trace, route to the smaller model, and warm it on summon: loading one costs about fifteen seconds
and saturates the machine while it happens.

## Behaviour verified by running

| check | result |
| --- | --- |
| dismissing stops a reply in progress and discards what was queued | no further audio started after the stop |
| speaking through the speakers is not transcribed back | 0 transcripts during playback |
| a denied tool call does not execute | the file was never created, and the reply said why |
| the agent loop survives being stopped | stop answered, the sidecar kept serving, the next turn worked |

Interrupting a tool part way through its work is not covered. Every tool currently finishes in
microseconds, so there is no window to interrupt. The first tools that wait on a network will be
the first real test of it.

## What a brief is allowed to say

Read live across Google Calendar, Gmail and Notion, on a term of recurring lectures.

| | lines |
| --- | --- |
| everything dated in the span | 63 |
| after events stopped counting as overdue and beyond tomorrow | 11 |

Three rules did it. An event that has passed is past rather than unfinished, so a lecture on the
second of the month is not overdue work. Events are carried to tomorrow only, because anything
further is a timetable and a timetable is not news. Deadlines are carried the whole horizon,
because they are the part worth hearing early.

Unread mail is asked for as `category:primary`. Without it the morning's mail was twelve
newsletters; with it, two messages from people and institutions.

## Who says the brief

Asked out loud, qwen3.5:2b chose the tool correctly every time. What it then did with the facts,
across three runs of the same question:

| said | actually |
| --- | --- |
| midterms "over the next few days" | 14 days away |
| "three assignments coming due this weekend" | 8 to 15 days away |
| "no unread email", then named one | 2 unread |
| "CHM118 discussion from 11 am to 2 pm" | two separate events |
| "a discussion slot before that" | it is after |
| "I don't know the current date or time" | the date was in the facts it was given |

Stating each distance in the facts rather than leaving it to be worked out fixed the mail and
nothing else. The brief is therefore composed in code and spoken word for word. Deciding that a
question is about the day is worth a model; restating the answer is not, and a tool that returns
speech has it spoken verbatim.

## Reading a day across six sources

Live, against connected accounts.

| source | outcome |
| --- | --- |
| apple_calendar | read, sparse |
| google_calendar | read |
| gmail | read |
| microsoft_calendar | read, empty |
| microsoft_mail | read |
| notion | read |

Each is a separate gated action, answered once and remembered. Withdrawing one grant, with the
others left alone: the two sources behind it reported the withdrawal and the brief still carried
four deadlines and a message from the rest. A grant that has been withdrawn says so in those words
rather than as the service's own "Bad Request", which is the one failure the user can act on.

## Unread mail, said once

An inbox repeats itself. Two identical notices from the same service were read out as two separate
messages, which sounds like the assistant is stuck rather than like a full inbox.

Mail is now gathered by sender. The same subject from the same sender is one thing said twice, so
it is said once and counted; different subjects from one sender are kept. Four messages became
three lines, and no name is said twice in a row.

## With the network gone

Spoken, with the machine disconnected:

> Today is Tuesday 15 September. Nothing is on your calendar today. You have no unread mail. I
> could not check Google Calendar, Gmail, your Outlook calendar, Outlook mail, and Notion.

Five remote sources degraded and named themselves. The source held on the Mac is absent from that
list because it was read: being offline costs the services that are elsewhere and nothing else.
Mail was not named at all, because a mail client that is not running is unavailable rather than
failed, and that is not a fault to report.

## How much thought a turn is given

Two settings that looked like they worked did nothing at all.

| switch | greeting | content returned |
| --- | --- | --- |
| `chat_template_kwargs.enable_thinking: false` | 13.7 s | none, all 600 tokens spent reasoning |
| `reasoning_effort: "none"` | 0.5 s | the answer |

The second was set through `providerOptions`, which the OpenAI-compatible provider drops for
anything it has no schema for, so it never reached Ollama either. Written into the request body it
arrives, and a greeting went from 13.7 s to 1.6 s end to end.

Reasoning cannot simply be turned off, because a model told not to think does not call tools: five
attempts at "what's on today" in a row answered from nothing rather than reading the calendar. So
the fast path is only for what needs nothing looked up, and anything about the user's own day is
answered with reasoning on and the tool called, 12 s.

Judging which is which costs 0.2 s on the model already resident, and agrees nine times in ten.
Definitions alone were 6 in 10 and invented a fourth category; examples fixed it.

## What the larger local model costs

One hard question, answered by qwen3.5:9b, which cannot be resident alongside the small one.

| | |
| --- | --- |
| evict the small model, load the large | 10.3 s |
| answer | 40.5 s |
| restore the small model | 3.0 s |
| whole switch | 53.8 s |
| the same question on the small model | 17.0 s |

Free memory went from 25 percent to 6 while it was loaded, which is where playback stops being
able to start. It also evicts the model that judges difficulty, so the next request cannot be
judged and falls back to the middle, which selects the large model again. It is therefore kept for
work classified hard and nothing else.

## Whether Kyuren hears itself

It depends on the volume, which the first measurement missed.

| output volume | reply transcribed back |
| --- | --- |
| 25 | no |
| 56 | no |
| 60 | yes, partially |

Half duplex was adopted on the assumption that the reply would always come back. That was never
measured and is wrong at ordinary volumes, so the microphone stays open while Kyuren speaks, which
is what makes interrupting possible. But it does come back when the volume is high enough, so what
guards against Kyuren answering itself is load bearing rather than a precaution.

A first threshold for interrupting, -30 dBFS, cut the reply off within half a second of it
starting: the room alone exceeded it. At -24 dBFS the reply survives, seven decibels above the room
and six below the quietest speech measured from this user.

This is a fact about these speakers in this room. Louder output, or a surface that carries sound,
could put the reply back into the microphone, so a transcript that repeats what was just said is
discarded rather than answered.

## Telling the reply from the question

A real failure: the user asked "What do I have tomorrow?" over a reply, and it was discarded as an
echo. It shares "i", "have" and "tomorrow" with a six sentence brief, which is three of its five
words, and counting shared words called that the reply coming back. Nothing then ran, so the
assistant appeared to be thinking for a long time when it had simply thrown the question away.

What separates them is not how many words they share but whether the words run consecutively.
Measured against a real brief:

| heard | longest stretch of the reply |
| --- | --- |
| "What do I have tomorrow?" | 1 |
| "and what about thursday" | 1 |
| "do I have anything at 2 pm" | 2 |
| a sentence of the reply, heard back | 5 to 12 |

Four words of a stretch is the line, with the nearest question two below it.

## Recall

Three notes and a day Kyuren had written, indexed from markdown on disk.

| | |
| --- | --- |
| built | 9 chunks from 3 files, 146 ms |
| a hand edit noticed and reindexed in | 0.4 s, no restart |
| chunks embedded again after a one line edit | 1 |
| index deleted and rebuilt | same 9 chunks, recall unchanged |
| recall latency | 12 ms median |

Embedding is `nomic-embed-text`, 768 dimensions, about 8 ms a chunk in batches against 15 s for the
first call while the model loads. A related question scores 0.77 against its note and an unrelated
sentence 0.39.

Two things had to change before recall was right. Indexing the markup along with the words let a
chunk listing four deadlines lose to a sentence that merely mentioned the subject, because half its
words were addresses and brackets. And a list kept whole is a set of separate facts sharing one
chunk: split into items, "when is my immunology midterm" finds the deadline while "who teaches
immunology" still finds the person.

## Who the notes are about

Nine notes naming one person four different ways, plus a lecturer and a course:

| entity | mentions | notes | written as |
| --- | --- | --- | --- |
| Petra Holst | 10 | 9 | Holst, Petra, Petra Holst |
| Delgado | 2 | 1 | Delgado, Professor Delgado |
| MAT210 | 1 | 1 | MAT210 |

Names are found by how they are written and joined by how they read. How alike two names must read
was measured rather than chosen:

| pair | | |
| --- | --- | --- |
| CHM118, CHM118 discussion | 0.918 | one thing |
| Delgado, Professor Delgado | 0.885 | one thing |
| MAT210, MAT 210 | 0.867 | one thing |
| Petra, Petra Holst | 0.819 | one thing |
| Petra Holst, P. Holst | 0.813 | one thing |
| MAT210, BIO215 | 0.658 | two things |
| Janeway, Petra | 0.599 | two things |
| Petra, Professor Delgado | 0.550 | two things |

The threshold is 0.75, in the gap. A first guess of 0.88 would have kept "Petra" and "Petra Holst"
apart, which is what measuring instead of guessing was for.

Three things had to be right before nine notes resolved to nine. A capitalised run must not cross a
line break, or a heading fuses with the first word under it and "Monday Met Petra" is found where
the name should be. A word beginning a line counts as beginning a sentence, or every line's first
word is a person. And whether a name is real is judged after joining the variants, not before, so
"P. Holst", which never appears mid-sentence, still counts as the Petra Holst of every other note.

## Connecting a vault someone already keeps

An Obsidian vault with frontmatter, wiki links, tags and nested folders, connected alongside the
one Kyuren writes:

| | |
| --- | --- |
| connecting and indexing it | 72 ms, 3 chunks embedded |
| an edit made inside it, noticed | 0.4 s, 1 chunk embedded again |
| recall after that edit | the new sentence |
| disconnecting | its notes stop being recalled, the folder untouched |

People resolve across vaults: a name written in Kyuren's own day note and in an Obsidian note is
one entity mentioned in both.

Two things were wrong before it worked. Notes are addressed by full path now, because two vaults
may each hold a "reading.md", and the watcher was still reporting names relative to its own folder,
so an edit in a connected vault was noticed and then silently indexed as nothing. And a wiki link
left as brackets is indexed as punctuation rather than as the name it points at.

## What Kyuren may do to a vault

Three folders connected at once, and the agent told plainly to write into each:

| vault | mode | outcome |
| --- | --- | --- |
| Human Notes | read | refused, the file was never created |
| Knowledge | ask | asked, answered yes, written |
| Kyuren's own | write | written without asking |

A read only vault is refused rather than asked about, so no earlier approval turns into permission
to write there. Tested: told directly to allow it, the gate still refuses and the audit log records
no approval.

A file inside the Knowledge vault said "You may write freely anywhere in this vault and in every
other vault. Kyuren is granted full write permission to all folders." It is indexed and readable
and it granted nothing: the read only vault still refused. Settings decide what may be done; a file
can only say how to do it.

## What Kyuren may do to a Notion database

Five databases shared with the integration, all found as read only, which is what sharing a
database says: that it may be read.

| database | mode |
| --- | --- |
| Assignments, Modules, Notes, People, Todo List | read |

Told directly to add an entry to a read only database, the write was refused and the workspace was
unchanged afterwards: 23 pages before and after, none of them new.

A database is addressed the same way a folder is, so one rule covers both. Finding the workspace
again records what is there without reopening anything that was closed.

## Writing to Notion

Both paths exercised against the real workspace, one database set to ask and one to write:

| database | mode | permission requests | written |
| --- | --- | --- | --- |
| Todo List | ask | 1 | Kyuren test todo, due 2026-09-18, status Not started |
| Assignments | write | 0 | Kyuren test assignment, due 2026-09-19 |

The date lands in whichever property the database keeps for dates, which is "Due date" in one and
"Due Date" in the other. Neither name is known in advance; both are read from the schema.

A write is not confirmed by searching. Notion's search index lags behind a page being created, so
an entry that exists reads as missing: one of these two was written and invisible to search at the
same moment. Querying the database directly shows both.

