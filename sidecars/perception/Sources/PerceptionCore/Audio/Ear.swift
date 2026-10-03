import FluidAudio
import Foundation

public enum EarError: Error, CustomStringConvertible {
    case cannotHear(String)
    case untrained

    public var description: String {
        switch self {
        case .cannotHear(let why): return "the wake word cannot be heard: \(why)"
        case .untrained: return "no wake word has been trained yet"
        }
    }
}

/// The wake word, listening. Raw microphone audio at whatever rate the device gives is resampled
/// to 16 kHz, put on the 16 bit scale the chain was trained against, heard in 80 ms chunks, and
/// judged by the trained head on the last sixteen embeddings. Nothing runs on the audio thread but
/// a copy; all of this happens on a queue of its own.
public final class Ear: @unchecked Sendable {
    private let transport: any Transport
    private let hearing: Result<Hearing, Error>
    private let converter = AudioConverter(sampleRate: Double(HEARD_RATE))
    private let queue = DispatchQueue(label: "kyuren.ear")
    private let lock = NSLock()
    private var listening = false
    private var threshold = 0.5
    private var pending: [Float] = []
    private var waking = Waking()
    private var complained = false
    private var vad: VadManager?
    private var forVad: [Float] = []
    private var vadWork: Task<Void, Never>?
    private var voiced = Voiced()

    public init(transport: any Transport) {
        self.transport = transport
        hearing = Result { try Hearing() }
    }

    /// Why the wake word cannot be listened for, if it cannot.
    public var trouble: String? {
        switch hearing {
        case .failure(let why): return String(describing: why)
        case .success(let hearing): return hearing.trained ? nil : EarError.untrained.description
        }
    }

    public var isListening: Bool {
        lock.withLock { listening }
    }

    public func start(threshold wanted: Double) throws {
        switch hearing {
        case .failure(let why): throw EarError.cannotHear(String(describing: why))
        case .success(let hearing): guard hearing.trained else { throw EarError.untrained }
        }
        lock.withLock {
            threshold = wanted
            listening = true
        }
        wakeVad()
    }

    /// The voice detector is the same one transcription uses, loaded once and kept. Until it is
    /// ready the ear judges by the head alone, as it always did, rather than going deaf.
    private func wakeVad() {
        queue.async { [weak self] in
            guard let self, self.vad == nil, self.vadWork == nil else { return }
            self.vadWork = Task { [weak self] in
                guard let made = try? await VadManager(config: VadConfig()) else {
                    FileHandle.standardError.write(Data("kyuren ear: the voice detector could not load, wakes are not gated\n".utf8))
                    return
                }
                self?.queue.async { self?.vad = made }
            }
        }
    }

    public func stop() {
        lock.withLock { listening = false }
        queue.async { [weak self] in
            guard let self, case .success(let hearing) = self.hearing else { return }
            hearing.forget()
            self.pending = []
            self.waking = Waking()
        }
    }

    /// Called on the audio thread with whatever the device gives. Only a copy happens here.
    public func receive(_ samples: [Float], sourceRate: Double) {
        guard isListening else { return }
        let copied = samples
        queue.async { [weak self] in self?.consume(copied, sourceRate: sourceRate) }
    }

    private func consume(_ samples: [Float], sourceRate: Double) {
        guard isListening, case .success(let hearing) = hearing else { return }
        do {
            let resampled = try converter.resample(samples, from: sourceRate)
            listenForVoice(resampled)
            pending.append(contentsOf: resampled.map { $0 * 32767 })
            while pending.count >= CHUNK {
                let chunk = Array(pending.prefix(CHUNK))
                pending.removeFirst(CHUNK)
                try hearing.hear(chunk)
                guard let recent = hearing.recent else { continue }
                judge(try hearing.judge(recent))
            }
        } catch {
            // Said once: a chain that will not run sounds exactly like silence.
            if !complained {
                complained = true
                transport.send(.event(name: "wake.trouble", data: .object(["reason": .string(String(describing: error))])))
            }
        }
    }

    /// The detector hears the same sound as the head, in its own larger chunks, one after another.
    /// What it says is only when a voice was last heard; the head still decides what was said.
    private func listenForVoice(_ resampled: [Float]) {
        forVad.append(contentsOf: resampled)
        guard let vad, forVad.count >= VadManager.chunkSize else { return }
        let chunk = Array(forVad.prefix(VadManager.chunkSize))
        forVad.removeFirst(VadManager.chunkSize)
        let previous = vadWork
        vadWork = Task { [weak self] in
            await previous?.value
            guard let results = try? await vad.process(chunk) else { return }
            let speech = results.contains { $0.isVoiceActive }
            let now = Date().timeIntervalSinceReferenceDate
            self?.lock.withLock { self?.voiced.heard(speech: speech, at: now) }
        }
    }

    private func judge(_ score: Double) {
        let bar = lock.withLock { threshold }
        guard waking.heard(score, over: bar) else { return }
        // A gated wake still resets the rule, so a slam does not prime the next chunk either.
        let gated = lock.withLock { vad != nil && !voiced.spoken(at: Date().timeIntervalSinceReferenceDate) }
        if gated { return }
        transport.send(.event(name: "wake.heard", data: .object(["score": .number((score * 1000).rounded() / 1000)])))
    }
}
