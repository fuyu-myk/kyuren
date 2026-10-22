import FluidAudio
import Foundation

/// What turns a sentence into sound: the synthesiser, or a stand-in for it in a test.
typealias Rendering = @Sendable (String) async throws -> (samples: [Float], acousticMs: Double)

/// Speaks text aloud, one sentence at a time so audio starts before the whole reply is generated.
/// A reply can be given as it arrives: what is added joins what is being said, and it ends once
/// its end has been said and all of it heard. Each utterance is said after the one before it rather
/// than over it, until something stops them all.
public final class Voice: @unchecked Sendable {
    public static let sampleRate = Double(KokoroAneConstants.sampleRate)

    private let transport: any Transport
    private let speaker: Speaker
    private let rendering: Rendering?
    private let lock = NSLock()
    /// Held while whoever listens is told whether Kyuren is speaking, so two tellings cannot cross.
    private let announcing = NSLock()

    private var manager: KokoroAneManager?
    private var loading: Task<KokoroAneManager?, Never>?
    private var task: Task<Void, Never>?
    private var open: AsyncStream<String>.Continuation?
    private var synthesising = false
    private var settled = true
    private var onSpeaking: (@Sendable (Bool) -> Void)?
    private var said = ""
    /// Moved on by every stop, so an utterance still finishing from before one can tell that
    /// nothing it does now is wanted.
    private var generation = 0
    /// What whoever listens was last told. Read and written only while announcing.
    private var lastTold = false

    public convenience init(station: Station, transport: any Transport) {
        self.init(transport: transport, rendering: nil)
    }

    init(transport: any Transport, rendering: Rendering?) {
        self.transport = transport
        self.rendering = rendering
        self.speaker = Speaker(
            sampleRate: Self.sampleRate,
            onFailure: { reason in
                transport.send(.event(
                    name: "voice.failed",
                    data: .object(["reason": .string(reason)])
                ))
            },
            onLevel: { value in
                transport.send(.event(
                    name: "audio.level",
                    data: .object(["level": .number(Double(value))])
                ))
            }
        )
    }

    /// Sound playing, or an utterance under way, the pauses between its sentences included: talking
    /// over a pause is talking over the reply.
    public var isSpeaking: Bool {
        speaker.isPlaying || lock.withLock { open != nil || !settled }
    }

    /// What was last read aloud, so a transcript of it can be told apart from the user talking.
    public var lastSpoken: String {
        lock.withLock { said }
    }

    public func whenSpeakingChanges(_ handler: @escaping @Sendable (Bool) -> Void) {
        lock.withLock { onSpeaking = handler }
    }

    /// Tells whoever listens whether Kyuren is speaking as things now stand. Called after every
    /// change, so whichever telling comes last is the truth, and nothing is told twice over.
    private func announceSpeaking() {
        announcing.withLock {
            let (speaking, listener) = lock.withLock { (!settled, onSpeaking) }
            guard speaking != lastTold else { return }
            lastTold = speaking
            listener?(speaking)
        }
    }

    /// Loads the synthesiser ahead of the first reply. Cold loading takes about ten seconds, which
    /// would otherwise land between the user finishing their sentence and hearing anything back.
    public func warm() {
        Task.detached { [weak self] in
            guard let manager = await self?.ready() else { return }
            // Loading the model is not the same as warming it. The first synthesis pays an ANE
            // compile of roughly two seconds, so one throwaway phrase is run here and discarded
            // rather than charged to the user's first reply.
            _ = try? await manager.synthesizeDetailed(text: "Ready.")
            self?.transport.send(.event(name: "voice.warm", data: nil))
        }
    }

    /// Something said in its own right, such as a notice: whole, and after whatever is being said,
    /// which goes on being said.
    public func say(_ text: String) {
        let utterance = lock.withLock { utter() }
        utterance.yield(text)
        utterance.finish()
    }

    /// More of what is being said, spoken after what came before it; with nothing open, the
    /// beginning of something new.
    public func add(_ text: String) {
        lock.withLock {
            if open == nil { open = utter() }
            open?.yield(text)
        }
    }

    /// An utterance of its own, heard once the one before it is over. Called holding the lock.
    private func utter() -> AsyncStream<String>.Continuation {
        let (stream, continuation) = AsyncStream<String>.makeStream()
        let before = task
        let mine = generation
        task = Task<Void, Never> { [weak self] in
            await withTaskCancellationHandler {
                await before?.value
            } onCancel: {
                before?.cancel()
            }
            await self?.perform(stream, as: mine)
        }
        return continuation
    }

    /// Makes a change for an utterance only while nothing has been stopped since it began, and says
    /// whether it was.
    @discardableResult
    private func ongoing(_ mine: Int, _ change: () -> Void = {}) -> Bool {
        lock.withLock {
            guard generation == mine else { return false }
            change()
            return true
        }
    }

    /// Nothing more is coming: what is being said ends once all of it has been heard.
    public func end() {
        let closing = lock.withLock { () -> AsyncStream<String>.Continuation? in
            let closing = open
            open = nil
            return closing
        }
        closing?.finish()
    }

    /// Cancels synthesis and silences playback at once, with everything waiting to be said. This is
    /// the barge-in path.
    public func stop() {
        let (running, closing) = lock.withLock { () -> (Task<Void, Never>?, AsyncStream<String>.Continuation?) in
            generation += 1
            let taken = (task, open)
            task = nil
            open = nil
            synthesising = false
            settled = true
            return taken
        }
        running?.cancel()
        closing?.finish()
        speaker.stop()
        announceSpeaking()
    }

    public func shutdown() {
        stop()
        speaker.shutdown()
    }

    /// Single flight: warming and the first reply can arrive together, and loading the model twice
    /// wastes ten seconds and a second copy of it in memory.
    private func ready() async -> KokoroAneManager? {
        if let existing = lock.withLock({ manager }) {
            return existing
        }

        let load: Task<KokoroAneManager?, Never> = lock.withLock {
            if let running = loading {
                return running
            }
            let created = Task<KokoroAneManager?, Never> { [weak self] in
                await self?.loadManager() ?? nil
            }
            loading = created
            return created
        }

        return await load.value
    }

    private func loadManager() async -> KokoroAneManager? {
        transport.send(.event(name: "voice.loading", data: nil))

        // The library routes the noise and tail stages to the GPU by default. On this machine that
        // is bimodal, roughly 950 ms with occasional 100 ms, while forcing every stage onto the
        // Neural Engine is a consistent 90 ms for numerically equivalent audio. See MEASUREMENTS.
        let manager = KokoroAneManager(variant: .english, computeUnits: .allAne)
        do {
            try await manager.initialize()
        } catch {
            transport.send(.event(
                name: "voice.failed",
                data: .object(["reason": .string(String(describing: error))])
            ))
            lock.withLock { loading = nil }
            return nil
        }

        lock.withLock {
            self.manager = manager
            self.loading = nil
        }
        transport.send(.event(name: "voice.ready", data: nil))
        return manager
    }

    private func renderer() async -> Rendering? {
        if let rendering { return rendering }
        guard let manager = await ready() else { return nil }
        return { text in
            let result = try await manager.synthesizeDetailed(text: text)
            return (result.samples, result.timings.totalMs)
        }
    }

    private func perform(_ stream: AsyncStream<String>, as mine: Int) async {
        guard let render = await renderer() else { return }

        let begun = ongoing(mine) {
            synthesising = true
            settled = false
            said = ""
        }
        guard begun else { return }
        // Told before any audio plays, so everything else is lowered before Kyuren is heard.
        announceSpeaking()

        let began = Date()
        var announced = false
        var spoken = 0

        for await text in stream {
            guard ongoing(mine, { said = said.isEmpty ? text : "\(said) \(text)" }) else { return }

            for part in sentences(of: speakable(text)) {
                guard ongoing(mine) else { return }

                guard let result = try? await render(part) else {
                    guard ongoing(mine) else { return }
                    // A sentence the synthesiser cannot pronounce must not strand the whole
                    // utterance, which is what happened when the failure fell on the last one.
                    transport.send(.event(
                        name: "voice.skipped",
                        data: .object(["text": .string(String(part.prefix(120)))])
                    ))
                    continue
                }

                // Queued under the same check, so a stop in between cannot leave it to be heard.
                let queued = ongoing(mine) {
                    speaker.enqueue(result.samples) { [weak self] in
                        self?.settleIfDone()
                    }
                }
                guard queued else { return }

                spoken += 1
                if !announced {
                    announced = true
                    let elapsed = (Date().timeIntervalSince(began) * 1000).rounded()
                    let acoustic = result.acousticMs.rounded()
                    transport.send(.event(
                        name: "voice.started",
                        data: .object([
                            "firstAudioMs": .number(elapsed),
                            "acousticMs": .number(acoustic),
                            "frontendMs": .number(elapsed - acoustic),
                        ])
                    ))
                }
            }
        }

        guard ongoing(mine, { synthesising = false }) else { return }
        if spoken == 0 {
            transport.send(.event(
                name: "voice.failed",
                data: .object(["reason": .string("nothing in the reply could be spoken")])
            ))
        }
        settleIfDone()
    }

    /// Speaking ends when synthesis has stopped producing and the queue has drained, whichever
    /// happens last. Tying it to one particular sentence left the state stuck when that sentence
    /// was the one that failed.
    private func settleIfDone() {
        let ready = lock.withLock { !synthesising && !settled }
        guard ready, !speaker.isPlaying else { return }

        let claimed = lock.withLock { () -> Bool in
            guard !synthesising, !settled else { return false }
            settled = true
            return true
        }
        guard claimed else { return }

        announceSpeaking()
        transport.send(.event(name: "voice.finished", data: nil))
    }
}
