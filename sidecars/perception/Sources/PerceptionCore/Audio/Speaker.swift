@preconcurrency import AVFoundation
import Foundation

/// Playback through `AVAudioPlayer` rather than the capture engine.
///
/// Voice processing and an `AVAudioEngine` output cannot coexist on this platform: with voice
/// processing enabled the output node refuses to initialise (`-10875`), and a second engine fails
/// to start IO. A separate player is the only path that plays while echo cancellation is active,
/// which is what makes barge-in possible.
public final class Speaker: NSObject, AVAudioPlayerDelegate, @unchecked Sendable {
    private static let startAttempts = 4
    private static let startRetry: TimeInterval = 0.08

    private let sampleRate: Double
    private let lock = NSLock()

    private var queue: [Clip] = []
    private var player: AVAudioPlayer?
    private var playing: [Float] = []
    private var meter: DispatchSourceTimer?
    private var pending = 0
    private var generation = 0
    private var whenDrained: (@Sendable () -> Void)?
    private var failure: (@Sendable (String) -> Void)?
    private var level: (@Sendable (Float) -> Void)?

    nonisolated public init(
        sampleRate: Double,
        onFailure: (@Sendable (String) -> Void)? = nil,
        onLevel: (@Sendable (Float) -> Void)? = nil
    ) {
        self.sampleRate = sampleRate
        super.init()
        self.failure = onFailure
        self.level = onLevel
    }

    /// A clip leaves the queue before its player exists, and building one takes long enough to be
    /// noticed. Steps that have been dispatched but not yet resolved count as playing, or the
    /// utterance looks finished in the gap between the two and is cut off before it is heard.
    nonisolated public var isPlaying: Bool {
        lock.withLock { pending > 0 || player?.isPlaying == true || !queue.isEmpty }
    }

    nonisolated public func enqueue(_ samples: [Float], whenDrained: @escaping @Sendable () -> Void) {
        let spoken = louder(samples)
        let clip = Clip(
            data: wav(from: spoken, sampleRate: sampleRate),
            envelope: envelope(of: spoken, sampleRate: sampleRate)
        )

        let start = lock.withLock { () -> Int? in
            queue.append(clip)
            self.whenDrained = whenDrained
            // A step already on its way will pick this clip up. Dispatching a second one races it
            // for the queue and starts two clips over each other.
            guard player == nil, pending == 0 else { return nil }
            pending += 1
            return generation
        }
        if let start {
            advance(start)
        }
    }

    /// Drops everything queued and silences output immediately.
    nonisolated public func stop() {
        let stopping = lock.withLock { () -> AVAudioPlayer? in
            generation += 1
            queue.removeAll()
            let current = player
            player = nil
            playing = []
            whenDrained = nil
            return current
        }
        stopMetering()
        stopping?.stop()
        level?(0)
    }

    nonisolated public func shutdown() {
        stop()
    }

    /// `AVAudioPlayer` drives playback and delivers its delegate callbacks on the run loop of the
    /// thread that created it. Synthesis runs in a task on a cooperative pool thread, which has no
    /// run loop, so a player built there plays nothing and never reports finishing. It is created
    /// on the main thread, which does have one.
    nonisolated private func advance(_ era: Int) {
        DispatchQueue.main.async { [weak self] in
            self?.advanceOnMain(era)
        }
    }

    /// Steps count themselves out rather than being cleared by whoever cancelled them, so a stop
    /// between two utterances cannot retire a step belonging to the new one.
    nonisolated private func retire() {
        lock.withLock { pending = max(0, pending - 1) }
    }

    /// A stop between the dispatch and its arrival means this step belongs to an utterance that is
    /// no longer wanted. Acting on it anyway would start a clip on top of whatever came next.
    private func advanceOnMain(_ era: Int) {
        let step = lock.withLock { () -> Step in
            guard era == generation else { return .stale }
            return queue.isEmpty ? .drained : .play(queue.removeFirst())
        }

        switch step {
        case .stale:
            retire()

        case .drained:
            let finished = lock.withLock { () -> (@Sendable () -> Void)? in
                player = nil
                playing = []
                let callback = whenDrained
                whenDrained = nil
                return callback
            }
            stopMetering()
            retire()
            level?(0)
            finished?()

        case .play(let clip):
            do {
                let created = try AVAudioPlayer(data: clip.data)
                created.delegate = self
                lock.withLock {
                    player = created
                    playing = clip.envelope
                }
                begin(created, era: era, attempt: 0)
            } catch {
                failure?("could not start playback: \(error)")
                advanceOnMain(era)
            }
        }
    }

    /// Starting cold makes acquiring the output device part of `play`, and under load that is what
    /// fails. Preparing first takes the acquisition out of the start, and a refusal is treated as
    /// the device being momentarily busy rather than as the reply being unspeakable.
    private func begin(_ created: AVAudioPlayer, era: Int, attempt: Int) {
        guard lock.withLock({ era == generation }) else {
            retire()
            return
        }

        if created.prepareToPlay(), created.play() {
            retire()
            startMetering()
            return
        }

        guard attempt + 1 < Self.startAttempts else {
            failure?("the player refused to start after \(Self.startAttempts) attempts")
            advanceOnMain(era)
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + Self.startRetry) { [weak self] in
            self?.begin(created, era: era, attempt: attempt + 1)
        }
    }

    private enum Step {
        case stale
        case drained
        case play(Clip)
    }

    private struct Clip {
        let data: Data
        let envelope: [Float]
    }

    /// The orb follows what is being said. Reading the envelope against the player's own position
    /// keeps it in step with the audio rather than with when synthesis happened to finish.
    private func startMetering() {
        guard level != nil, lock.withLock({ meter }) == nil else { return }

        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: envelopeFrame)
        timer.setEventHandler { [weak self] in self?.meterOnce() }
        lock.withLock { meter = timer }
        timer.resume()
    }

    nonisolated private func stopMetering() {
        let timer = lock.withLock { () -> DispatchSourceTimer? in
            let running = meter
            meter = nil
            return running
        }
        timer?.cancel()
    }

    private func meterOnce() {
        let reading = lock.withLock { () -> Float? in
            guard let player, player.isPlaying else { return nil }
            return PerceptionCore.reading(playing, at: player.currentTime)
        }
        guard let reading else { return }
        level?(reading)
    }

    nonisolated public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully: Bool) {
        let era = lock.withLock { () -> Int in
            pending += 1
            return generation
        }
        advance(era)
    }
}
