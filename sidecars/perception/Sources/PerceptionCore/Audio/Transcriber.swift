@preconcurrency import AVFoundation
import FluidAudio

/// Wraps FluidAudio's streaming recogniser so the speech stream deals in sample arrays.
///
/// Audio is fed continuously rather than only between speech boundaries, because voice activity
/// is decided 256 ms late and gating on it would clip the start of every utterance.
public final class Transcriber {
    public static let variant = StreamingModelVariant.parakeetEou320ms

    private let format: AVAudioFormat
    private var manager: (any StreamingAsrManager)?

    public init?(sampleRate: Double) {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        ) else { return nil }
        self.format = format
    }

    public func load(onPartial: @escaping @Sendable (String) -> Void) async throws {
        let manager = Self.variant.createManager()
        try await manager.loadModels()
        await manager.setPartialTranscriptCallback(onPartial)
        self.manager = manager
    }

    public func append(_ samples: [Float]) async throws {
        guard let manager, let buffer = makeBuffer(samples) else { return }
        try await manager.appendAudio(buffer)
        try await manager.processBufferedAudio()
    }

    public func finish() async throws -> String {
        guard let manager else { return "" }
        let text = try await manager.finish()
        try await manager.reset()
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func makeBuffer(_ samples: [Float]) -> AVAudioPCMBuffer? {
        guard
            let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(samples.count)
            ),
            let channel = buffer.floatChannelData?[0]
        else { return nil }

        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            channel.update(from: source.baseAddress!, count: samples.count)
        }
        return buffer
    }
}
