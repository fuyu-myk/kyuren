@preconcurrency import AVFoundation
import Foundation

public enum MicrophoneError: Error, CustomStringConvertible {
    case notPermitted(MicrophonePermission)

    public var description: String {
        switch self {
        case .notPermitted(let permission):
            return "microphone access is \(permission.rawValue)"
        }
    }
}

/// Who wants the microphone open. The orb wants it for a turn; the ear wants it for as long as the
/// wake word is being listened for. It stays open while anyone wants it, and closes, actually
/// closes, when nobody does.
public enum Listener: Hashable, Sendable {
    case orb
    case ear
}

public final class Microphone: @unchecked Sendable {
    private let station: Station
    private let transport: any Transport
    private let onSamples: (@Sendable ([Float], Double) -> Void)?
    private let lock = NSLock()
    private var speaking = false
    private var wanted: Set<Listener> = []

    public init(
        station: Station,
        transport: any Transport,
        onSamples: (@Sendable ([Float], Double) -> Void)? = nil
    ) {
        self.station = station
        self.transport = transport
        self.onSamples = onSamples
    }

    public var isRunning: Bool {
        station.isRunning
    }

    /// Returns false when a permission prompt was raised instead, in which case capture begins
    /// later and announces itself with a microphone.started event.
    public func startAllowingPrompt(for who: Listener) throws -> Bool {
        switch MicrophonePermission.current() {
        case .authorized:
            try start(for: who)
            return true

        case .undetermined:
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                guard let self else { return }
                self.transport.send(.event(
                    name: "microphone.permission",
                    data: .object(["status": .string(MicrophonePermission.current().rawValue)])
                ))
                if granted {
                    try? self.start(for: who)
                }
            }
            return false

        case let refused:
            throw MicrophoneError.notPermitted(refused)
        }
    }

    public func start(for who: Listener) throws {
        let permission = MicrophonePermission.current()
        guard permission == .authorized else {
            throw MicrophoneError.notPermitted(permission)
        }
        lock.withLock { _ = wanted.insert(who) }
        // Summoning while already listening is not a restart. Tearing the engine down and building
        // it again mid-utterance loses whatever was being said.
        guard !station.isRunning else { return }

        try station.listen { [weak self] buffer in
            guard let self else { return }
            self.publish(level(of: buffer))
            if let onSamples = self.onSamples, let mono = firstChannel(of: buffer) {
                onSamples(mono, buffer.format.sampleRate)
            }
        }

        let format = station.inputFormat
        transport.send(.event(
            name: "microphone.started",
            data: .object([
                "sampleRate": .number(format.sampleRate),
                "channels": .number(Double(format.channelCount)),
            ])
        ))
    }

    public func stop(for who: Listener) {
        let stillWanted = lock.withLock {
            wanted.remove(who)
            return !wanted.isEmpty
        }
        // Someone else is still listening, so the microphone stays as it is.
        guard !stillWanted else { return }
        shutdown()
    }

    public func shutdown() {
        lock.withLock { wanted.removeAll() }
        guard station.isRunning else { return }
        station.stop()
        transport.send(.event(name: "microphone.stopped", data: nil))
    }

    /// Kyuren keeps listening while it speaks, so it can be interrupted. The microphone does not
    /// pick up these speakers, measured with capture left open through a whole spoken reply: not
    /// one word came back. What does change is the level channel, which goes to the reply for that
    /// stretch so the orb follows what is being said rather than what the room is doing.
    public func setSpeaking(_ wanted: Bool) {
        lock.withLock { speaking = wanted }
    }

    private func publish(_ value: Float) {
        guard !lock.withLock({ speaking }) else { return }
        transport.send(.event(
            name: "audio.level",
            data: .object(["level": .number(Double(value))])
        ))
    }
}
