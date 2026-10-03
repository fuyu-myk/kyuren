@preconcurrency import AVFoundation
import FluidAudio
import Foundation

/// Re-transcribes a finished utterance with a far larger offline model.
///
/// The streaming recogniser is 120M parameters and chosen for latency; it garbles short, quiet or
/// fast speech. Once an utterance ends its audio is complete, so there is no reason to keep using
/// a model constrained by having to answer before the sentence is over.
public final class Refiner: @unchecked Sendable {
    public static let windowSeconds = 15.0

    private let lock = NSLock()
    private var manager: UnifiedAsrManager?

    public init() {}

    /// Loading downloads a large model. It runs detached so the speech pipeline keeps working
    /// without it; refinement simply does not happen until it is ready.
    public func load() async throws {
        let manager = UnifiedAsrManager()
        try await manager.loadModels()
        lock.withLock { self.manager = manager }
    }

    /// Returns nil when refinement is unavailable or the audio is longer than the model's window,
    /// in which case the streaming transcript stands.
    public func refine(_ samples: [Float], sampleRate: Double) async -> String? {
        guard let manager = lock.withLock({ self.manager }) else { return nil }
        guard Double(samples.count) / sampleRate <= Self.windowSeconds else { return nil }

        guard let text = try? await manager.transcribe(samples) else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
