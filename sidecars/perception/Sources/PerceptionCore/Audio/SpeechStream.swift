import AVFoundation
import FluidAudio
import Foundation

/// Turns the microphone's raw buffers into speech boundaries.
///
/// The audio thread only copies samples. Resampling and inference happen on a consumer task, so a
/// slow model can never stall capture.
public final class SpeechStream: @unchecked Sendable {
    public static let chunkSize = VadManager.chunkSize
    public static let sampleRate = Double(VadManager.sampleRate)
    /// Voice activity reports speech after it has already started, so the audio just before the
    /// report is kept and prepended to the utterance.
    static let prerollSamples = Int(sampleRate * 0.75)
    static let utteranceCap = Int(sampleRate * Refiner.windowSeconds)

    private let transport: any Transport
    private let onBargeIn: (@Sendable () -> Bool)?
    private let recentlySaid: (@Sendable () -> String)?
    private let speaking: (@Sendable () -> Bool)?
    private let converter = AudioConverter()
    private let lock = NSLock()

    private var continuation: AsyncStream<[Float]>.Continuation?
    private var task: Task<Void, Never>?
    private var sourceRate: Double = 48000
    private var speechStartedAt: Date?

    public init(
        transport: any Transport,
        onBargeIn: (@Sendable () -> Bool)? = nil,
        recentlySaid: (@Sendable () -> String)? = nil,
        speaking: (@Sendable () -> Bool)? = nil
    ) {
        self.transport = transport
        self.onBargeIn = onBargeIn
        self.recentlySaid = recentlySaid
        self.speaking = speaking
    }

    public func receive(_ samples: [Float], sourceRate rate: Double) {
        lock.withLock { sourceRate = rate }
        continuation?.yield(samples)
    }

    public func start() {
        lock.lock()
        let alreadyRunning = task != nil
        lock.unlock()
        guard !alreadyRunning else { return }

        let (stream, continuation) = AsyncStream<[Float]>.makeStream(bufferingPolicy: .bufferingNewest(64))
        lock.withLock { self.continuation = continuation }

        let task = Task<Void, Never> { [weak self] in
            guard let self else { return }
            await self.consume(stream)
        }
        lock.withLock { self.task = task }
    }

    public func stop() {
        let (task, continuation) = lock.withLock { (self.task, self.continuation) }
        continuation?.finish()
        task?.cancel()
        lock.withLock {
            self.task = nil
            self.continuation = nil
        }
    }

    private func consume(_ stream: AsyncStream<[Float]>) async {
        let vad: VadManager
        do {
            transport.send(.event(name: "vad.loading", data: nil))
            vad = try await VadManager(config: VadConfig())
            transport.send(.event(name: "vad.ready", data: nil))
        } catch {
            report("vad.failed", error)
            return
        }

        guard let transcriber = Transcriber(sampleRate: Self.sampleRate) else {
            transport.send(.event(name: "asr.failed", data: .object(["reason": .string("unsupported format")])))
            return
        }
        do {
            transport.send(.event(name: "asr.loading", data: nil))
            try await transcriber.load { [weak self] text in
                self?.publishPartial(text)
            }
            transport.send(.event(name: "asr.ready", data: nil))
        } catch {
            report("asr.failed", error)
            return
        }

        let refiner = Refiner()
        let transport = self.transport
        transport.send(.event(name: "refine.loading", data: nil))
        Task.detached { [weak self] in
            do {
                try await refiner.load()
                transport.send(.event(name: "refine.ready", data: nil))
            } catch {
                self?.report("refine.failed", error)
            }
        }

        var state = await vad.makeStreamState()
        var buffered: [Float] = []
        var preroll: [Float] = []
        var utterance: [Float]?

        for await samples in stream {
            if Task.isCancelled { return }

            let rate = lock.withLock { sourceRate }
            guard let resampled = try? converter.resample(samples, from: rate) else { continue }

            // Someone talking over the reply wants it to stop, and waiting for voice activity to
            // agree takes a quarter of a second longer than that is worth.
            if loudEnoughToInterrupt(resampled), onBargeIn?() == true {
                transport.send(.event(name: "voice.interrupted", data: nil))
            }

            try? await transcriber.append(resampled)
            buffered.append(contentsOf: resampled)

            if utterance != nil {
                utterance?.append(contentsOf: resampled)
                if let count = utterance?.count, count > Self.utteranceCap {
                    utterance?.removeFirst(count - Self.utteranceCap)
                }
            } else {
                preroll.append(contentsOf: resampled)
                if preroll.count > Self.prerollSamples {
                    preroll.removeFirst(preroll.count - Self.prerollSamples)
                }
            }

            while buffered.count >= Self.chunkSize {
                let chunk = Array(buffered.prefix(Self.chunkSize))
                buffered.removeFirst(Self.chunkSize)

                guard let result = try? await vad.processStreamingChunk(chunk, state: state) else {
                    continue
                }
                state = result.state
                guard let event = result.event else { continue }

                switch event.kind {
                case .speechStart:
                    lock.withLock { speechStartedAt = Date() }
                    utterance = preroll
                    preroll = []
                    announce("speech.start", result.probability, event.sampleIndex)

                case .speechEnd:
                    announce("speech.end", result.probability, event.sampleIndex)
                    lock.withLock { speechStartedAt = nil }
                    let streamed = (try? await transcriber.finish()) ?? ""
                    let spoken = utterance ?? []
                    utterance = nil

                    let began = Date()
                    let refined = await refiner.refine(spoken, sampleRate: Self.sampleRate)
                    let text = refined ?? streamed

                    if !text.isEmpty, Echo.isEcho(heard: text, justSaid: recentlySaid?() ?? "") {
                        // These speakers are not heard by this microphone, so this should never
                        // fire. If it does, the room has changed and answering would mean Kyuren
                        // talking to itself.
                        transport.send(.event(
                            name: "transcript.discarded",
                            data: .object(["text": .string(text), "reason": .string("heard its own reply")])
                        ))
                    } else if !text.isEmpty {
                        transport.send(.event(
                            name: "transcript.final",
                            data: .object([
                                "text": .string(text),
                                "source": .string(refined == nil ? "streaming" : "refined"),
                                "streamed": .string(streamed),
                                "refineMs": .number((Date().timeIntervalSince(began) * 1000).rounded()),
                            ])
                        ))
                    }
                }
            }
        }
    }

    private func announce(_ name: String, _ probability: Float, _ sample: Int) {
        transport.send(.event(
            name: name,
            data: .object([
                "probability": .number(Double(probability)),
                "sample": .number(Double(sample)),
            ])
        ))
    }

    private func publishPartial(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // While Kyuren is talking the microphone catches some of it, and a partial is too short to
        // tell the reply from the user. Showing the assistant its own words as though the user had
        // said them is worse than showing nothing until the utterance is complete, which is judged.
        guard !(speaking?() ?? false) else { return }

        var data: [String: JSONValue] = ["text": .string(trimmed)]
        if let since = lock.withLock({ speechStartedAt }) {
            data["sinceSpeechStartMs"] = .number((Date().timeIntervalSince(since) * 1000).rounded())
        }
        transport.send(.event(name: "transcript.partial", data: .object(data)))
    }

    private func report(_ name: String, _ error: Error) {
        transport.send(.event(
            name: name,
            data: .object(["reason": .string(String(describing: error))])
        ))
    }
}
