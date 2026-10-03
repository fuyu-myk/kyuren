import Foundation

/// Where speech should sit, as the level a whole clip averages to, and the loudest any one sample
/// may be. The synthesiser speaks at around minus twenty seven decibels, which is a voice across a
/// room, and a reply should be a voice beside you.
private let TARGET: Float = 0.126
private let CEILING: Float = 0.98
private let MOST: Float = 4

/// A clip brought up to speaking level. The whole clip is scaled by one number, so nothing about
/// its shape changes, and if that would push any sample past the ceiling the whole clip is brought
/// back down so it does not: a little quieter, never clipped.
public func louder(_ samples: [Float]) -> [Float] {
    guard !samples.isEmpty else { return samples }
    let rms = (samples.reduce(0) { $0 + $1 * $1 } / Float(samples.count)).squareRoot()
    guard rms > 0 else { return samples }

    var gain = min(MOST, TARGET / rms)
    let peak = samples.reduce(0) { max($0, abs($1)) }
    if peak * gain > CEILING {
        gain = CEILING / peak
    }
    guard gain > 1 else { return samples }
    return samples.map { $0 * gain }
}
