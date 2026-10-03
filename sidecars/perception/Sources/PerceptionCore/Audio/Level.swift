import Accelerate
import AVFoundation

private let quiet: Float = -32
private let loud: Float = -14
private let knee: Float = 1.4

/// Tuned against a recorded session of real speech rather than estimates: that voice peaks near
/// -16 dBFS, so a ceiling of -6 wasted a third of the range and left the orb sluggish.
/// Tuned for unprocessed input, which is what listening uses. Voice processing suppresses noise as
/// well as cancelling echo, so the same room measures about -30 dBFS raw against -40 through it.
/// A linear map of that floor would leave the orb permanently agitated in silence; the knee pushes
/// quiet input toward zero without clipping speech.
public func level(of buffer: AVAudioPCMBuffer) -> Float {
    guard let channel = buffer.floatChannelData?[0] else { return 0 }

    let frames = vDSP_Length(buffer.frameLength)
    guard frames > 0 else { return 0 }

    var meanSquare: Float = 0
    vDSP_measqv(channel, 1, &meanSquare, frames)
    return level(ofMeanSquare: meanSquare)
}

/// Synthesised speech is measured on the same curve as heard speech, so the orb behaves the same
/// whether it is listening or talking.
public func level(ofMeanSquare meanSquare: Float) -> Float {
    let decibels = 10 * log10(max(meanSquare, 1e-12))
    let span = max(0, min(1, (decibels - quiet) / (loud - quiet)))
    return pow(span, knee)
}

/// Every channel of the voice-processed device carries identical content, so the first is enough.
public func firstChannel(of buffer: AVAudioPCMBuffer) -> [Float]? {
    guard let channel = buffer.floatChannelData?[0] else { return nil }
    let frames = Int(buffer.frameLength)
    guard frames > 0 else { return nil }
    return Array(UnsafeBufferPointer(start: channel, count: frames))
}

/// Barge-in threshold in mean square, about -24 dBFS.
///
/// Room tone in this room measures close to -31, and a first attempt at -30 cut the reply off
/// within half a second of it starting: the room alone was enough. Speech from this user measures
/// between -20 and -14, so this sits seven decibels above the room and six below the quietest
/// thing worth interrupting for.
private let interruptThreshold: Float = 4e-3

/// Voice activity decides 256 ms late, which is slower than interrupting allows for. This is the
/// quick judgement that something loud enough to be the user has started.
public func loudEnoughToInterrupt(_ samples: [Float]) -> Bool {
    guard !samples.isEmpty else { return false }

    var meanSquare: Float = 0
    samples.withUnsafeBufferPointer { buffer in
        guard let base = buffer.baseAddress else { return }
        vDSP_measqv(base, 1, &meanSquare, vDSP_Length(samples.count))
    }
    return meanSquare > interruptThreshold
}
