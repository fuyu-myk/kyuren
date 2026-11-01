import Accelerate

/// One window of the music, as bands from the bass up, each from 0 to 1.
public struct Heard: Sendable {
    public let levels: [Float]
    /// Nothing at all came through, as when macOS has not let the music be heard, rather than a
    /// quiet passage.
    public let silent: Bool
}

/// The music split into bands spaced as pitch is heard, for the island to draw. A window of 4096
/// samples is about 85 ms at 48 kHz, the shortest that still gives the lowest bands a bin of their
/// own; it is measured afresh far more often than that, so it keeps up with a beat.
public final class Bands {
    public static let size = 4096
    public static let count = 24
    static let lowest = 40.0
    static let highest = 16_000.0
    /// Music loses about 3 dB an octave from the bass up, so each band is lifted by as much from
    /// 1 kHz and a whole mix stands level rather than sloping away to the right.
    static let tilt: Float = 3
    /// Pink noise at -14 dBFS, as loud as a loud master, measures about -38 dB in every band.
    static let floor: Float = -65
    static let ceiling: Float = -23

    private let fft: vDSP.FFT<DSPSplitComplex>
    private let window: [Float]

    public init() {
        fft = vDSP.FFT(log2n: vDSP_Length(Self.size.trailingZeroBitCount), radix: .radix2, ofType: DSPSplitComplex.self)!
        window = vDSP.window(ofType: Float.self, usingSequence: .hanningDenormalized, count: Self.size, isHalfWindow: false)
    }

    /// Where each band begins, and the last band's end, in hertz.
    static func edges(rate: Double) -> [Double] {
        let top = min(highest, rate / 2)
        return (0...count).map { lowest * pow(top / lowest, Double($0) / Double(count)) }
    }

    public func measure(_ samples: [Float], rate: Double) -> Heard {
        let empty = Heard(levels: [Float](repeating: 0, count: Self.count), silent: true)
        guard samples.count == Self.size else { return empty }
        var meanSquare: Float = 0
        vDSP_measqv(samples, 1, &meanSquare, vDSP_Length(samples.count))
        guard meanSquare > 0 else { return empty }

        let power = spectrum(of: samples)
        let spacing = rate / Double(Self.size)
        let edges = Self.edges(rate: rate)
        let levels = (0..<Self.count).map { band -> Float in
            let low = max(1, Int((edges[band] / spacing).rounded(.up)))
            let high = min(power.count - 1, Int((edges[band + 1] / spacing).rounded(.down)))
            let centre = (edges[band] * edges[band + 1]).squareRoot()
            let bins = low <= high ? Array(power[low...high]) : [power[min(power.count - 1, Int((centre / spacing).rounded()))]]
            let mean = bins.reduce(0, +) / Float(bins.count)
            // A bin's power over (size / 2) squared is a tone's amplitude squared.
            let scale = Float(Self.size / 2) * Float(Self.size / 2)
            let decibels = 10 * log10(max(mean / scale, 1e-18)) + Self.tilt * Float(log2(centre / 1_000))
            return min(1, max(0, (decibels - Self.floor) / (Self.ceiling - Self.floor)))
        }
        return Heard(levels: levels, silent: false)
    }

    /// The power in each bin of a Hann-windowed window, bin 0 being the steady offset.
    private func spectrum(of samples: [Float]) -> [Float] {
        let half = Self.size / 2
        let windowed = vDSP.multiply(samples, window)
        var real = [Float](repeating: 0, count: half)
        var imaginary = [Float](repeating: 0, count: half)
        var power = [Float](repeating: 0, count: half)
        real.withUnsafeMutableBufferPointer { realBuffer in
            imaginary.withUnsafeMutableBufferPointer { imaginaryBuffer in
                var split = DSPSplitComplex(realp: realBuffer.baseAddress!, imagp: imaginaryBuffer.baseAddress!)
                windowed.withUnsafeBufferPointer { buffer in
                    buffer.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: half) {
                        vDSP_ctoz($0, 2, &split, 1, vDSP_Length(half))
                    }
                }
                fft.forward(input: split, output: &split)
                vDSP.squareMagnitudes(split, result: &power)
            }
        }
        return power
    }
}
