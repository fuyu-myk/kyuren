import Accelerate
import Foundation

/// How much of a clip one envelope reading covers. Matched to the rate the reading is sampled at
/// during playback, so each frame is used about once.
public let envelopeFrame: Double = 1.0 / 30

/// Loudness per frame, measured once when the clip is made rather than repeatedly while it plays.
public func envelope(of samples: [Float], sampleRate: Double) -> [Float] {
    let width = max(1, Int(sampleRate * envelopeFrame))
    guard !samples.isEmpty else { return [] }

    return samples.withUnsafeBufferPointer { buffer -> [Float] in
        guard let base = buffer.baseAddress else { return [] }
        return stride(from: 0, to: samples.count, by: width).map { start in
            var meanSquare: Float = 0
            let count = min(width, samples.count - start)
            vDSP_measqv(base + start, 1, &meanSquare, vDSP_Length(count))
            return level(ofMeanSquare: meanSquare)
        }
    }
}

/// The reading for a moment in the clip, held at the last frame once playback runs past the end.
public func reading(_ envelope: [Float], at seconds: Double) -> Float {
    guard !envelope.isEmpty else { return 0 }
    let index = max(0, Int(seconds / envelopeFrame))
    return envelope[min(index, envelope.count - 1)]
}
