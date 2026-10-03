import FluidAudio
import Foundation

/// Speaks text aloud, one sentence at a time so audio starts before the whole reply is generated.
public final class Voice: @unchecked Sendable {
    public static let sampleRate = Double(KokoroAneConstants.sampleRate)

    private let transport: any Transport
    private let speaker: Speaker
    private let lock = NSLock()

    private var manager: KokoroAneManager?
    private var loading: Task<KokoroAneManager?, Never>?
    private var task: Task<Void, Never>?
    private var synthesising = false
    private var settled = true
    private var onSpeaking: (@Sendable (Bool) -> Void)?
    private var said = ""

    public init(station: Station, transport: any Transport) {
        self.transport = transport
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

    public var isSpeaking: Bool {
        speaker.isPlaying
    }

    /// What was last read aloud, so a transcript of it can be told apart from the user talking.
    public var lastSpoken: String {
        lock.withLock { said }
    }

    public func whenSpeakingChanges(_ handler: @escaping @Sendable (Bool) -> Void) {
        lock.withLock { onSpeaking = handler }
    }

    private func announceSpeaking(_ speaking: Bool) {
        lock.withLock { onSpeaking }?(speaking)
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

    public func say(_ text: String) {
        stop()
        lock.withLock { said = text }

        let parts = sentences(of: speakable(text))
        guard !parts.isEmpty else {
            transport.send(.event(
                name: "voice.failed",
                data: .object(["reason": .string("the reply was all markup, nothing to speak")])
            ))
            return
        }

        let task = Task<Void, Never> { [weak self] in
            await self?.perform(parts)
        }
        lock.withLock { self.task = task }
    }

    /// Cancels synthesis and silences playback at once. This is the barge-in path.
    public func stop() {
        let running = lock.withLock { () -> Task<Void, Never>? in
            let running = task
            task = nil
            return running
        }
        running?.cancel()
        speaker.stop()
        lock.withLock {
            synthesising = false
            settled = true
        }
        announceSpeaking(false)
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

    private func perform(_ parts: [String]) async {
        guard let manager = await ready() else { return }
        if Task.isCancelled { return }

        // Echo cancellation has to be on before any audio plays: switching it restarts the capture
        // engine, and the switch is what stops Kyuren hearing itself.
        announceSpeaking(true)
        lock.withLock {
            synthesising = true
            settled = false
        }

        let began = Date()
        var announced = false
        var spoken = 0

        for part in parts {
            if Task.isCancelled { return }

            guard let result = try? await manager.synthesizeDetailed(text: part) else {
                // A sentence the synthesiser cannot pronounce must not strand the whole utterance,
                // which is what happened when the failure fell on the last one.
                transport.send(.event(
                    name: "voice.skipped",
                    data: .object(["text": .string(String(part.prefix(120)))])
                ))
                continue
            }
            if Task.isCancelled { return }

            speaker.enqueue(result.samples) { [weak self] in
                self?.settleIfDone()
            }

            spoken += 1
            if !announced {
                announced = true
                let elapsed = (Date().timeIntervalSince(began) * 1000).rounded()
                let acoustic = result.timings.totalMs.rounded()
                transport.send(.event(
                    name: "voice.started",
                    data: .object([
                        "firstAudioMs": .number(elapsed),
                        "acousticMs": .number(acoustic),
                        "frontendMs": .number(elapsed - acoustic),
                        "sentences": .number(Double(parts.count)),
                    ])
                ))
            }
        }

        lock.withLock { synthesising = false }
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
            guard !settled else { return false }
            settled = true
            return true
        }
        guard claimed else { return }

        announceSpeaking(false)
        transport.send(.event(name: "voice.finished", data: nil))
    }
}
