@preconcurrency import AVFoundation
import Foundation

/// The capture engine.
///
/// Capture only, and without voice processing. Voice processing cannot initialise while the
/// default input and output devices disagree on a sample rate, and once it is enabled on the input
/// nothing in the process can start playback at all. Kyuren stops listening while it speaks
/// instead. See MEASUREMENTS.
public final class Station: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let lock = NSLock()

    private var running = false
    private var tapped = false
    private var listener: (@Sendable (AVAudioPCMBuffer) -> Void)?

    public init() {}

    public var isRunning: Bool {
        lock.withLock { running }
    }

    public var inputFormat: AVAudioFormat {
        engine.inputNode.outputFormat(forBus: 0)
    }

    public func listen(_ onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws {
        lock.withLock { listener = onBuffer }
        try restart()
    }

    public func stop() {
        lock.withLock {
            untap()
            guard running else { return }
            engine.stop()
            running = false
        }
    }

    public func shutdown() {
        stop()
        lock.withLock { listener = nil }
    }

    private func restart() throws {
        try lock.withLock {
            untap()
            if running {
                engine.stop()
                running = false
            }

            let input = engine.inputNode
            if let listener {
                let format = input.outputFormat(forBus: 0)
                input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                    listener(buffer)
                }
                tapped = true
            }

            engine.prepare()
            do {
                try engine.start()
            } catch {
                // A tap left behind by a start that failed is what the next attempt would install
                // over, and installing over a tap raises rather than returning an error.
                untap()
                throw error
            }
            running = true
        }
    }

    /// Whether a tap exists is tracked rather than inferred from whether the engine is running: a
    /// start that fails leaves one installed while the engine is stopped.
    private func untap() {
        guard tapped else { return }
        engine.inputNode.removeTap(onBus: 0)
        tapped = false
    }
}
