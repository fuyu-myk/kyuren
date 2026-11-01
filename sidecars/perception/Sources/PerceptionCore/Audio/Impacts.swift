import Accelerate

/// How hard the music has just hit, from 0 to 1: its newest moment against the second or so
/// before it, so a drop or a heavy beat stands out from music that is merely loud.
public final class Impacts {
    /// About 43 ms at 48 kHz, a little longer than the time between measures, so no hit falls
    /// between two.
    static let moment = 2048
    /// How long the music before is remembered, in seconds.
    static let memory = 1.0
    /// Decibels over the music before at which a hit begins to show, and at which it shows in full.
    static let onset: Float = 3
    static let full: Float = 9
    /// Out of music before quieter than this, in dBFS, nothing is a hit: music starting is not one.
    static let quietest: Float = -50

    private var before: Float?

    public init() {}

    public func hear(_ samples: [Float], after interval: Double) -> Float {
        let moment = Array(samples.suffix(Self.moment))
        guard !moment.isEmpty else { return 0 }
        var now: Float = 0
        vDSP_measqv(moment, 1, &now, vDSP_Length(moment.count))
        // Out of silence the music is taken as it comes, rather than eased up to from nothing.
        guard let was = before, was > pow(10, Self.quietest / 10) else {
            before = now
            return 0
        }
        before = was + (now - was) * Float(1 - exp(-interval / Self.memory))
        let over = 10 * log10(max(now, 1e-18) / was)
        return min(1, max(0, (over - Self.onset) / (Self.full - Self.onset)))
    }

    public func reset() {
        before = nil
    }
}
