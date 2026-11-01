import Foundation
import Testing

@testable import PerceptionCore

@Suite("Bands")
struct BandsTests {
    private let rate = 48_000.0

    private func tone(_ frequency: Double, peak: Float) -> [Float] {
        (0..<Bands.size).map { peak * Float(sin(2 * Double.pi * frequency * Double($0) / rate)) }
    }

    /// Equal power in every octave, as music roughly has, scaled to a root mean square in dBFS.
    private func pink(decibels: Float) -> [Float] {
        var generator = SystemRandomNumberGenerator()
        var rows = [Float](repeating: 0, count: 16)
        var samples = [Float](repeating: 0, count: Bands.size)
        for index in samples.indices {
            // Voss-McCartney: each row changes half as often as the one before.
            let row = index == 0 ? 0 : min(15, index.trailingZeroBitCount)
            rows[row] = Float.random(in: -1...1, using: &generator)
            samples[index] = rows.reduce(0, +) + Float.random(in: -1...1, using: &generator)
        }
        let rms = (samples.reduce(0) { $0 + $1 * $1 } / Float(samples.count)).squareRoot()
        let wanted = pow(10, decibels / 20)
        return samples.map { $0 * wanted / rms }
    }

    @Test("silence leaves every band empty and is told as silence")
    func silenceLeavesEveryBandEmpty() {
        let heard = Bands().measure([Float](repeating: 0, count: Bands.size), rate: rate)
        #expect(heard.levels.count == Bands.count)
        #expect(heard.levels.allSatisfy { $0 == 0 })
        #expect(heard.silent)
    }

    @Test("a tone lights the band holding its pitch more than any other")
    func aToneLightsItsOwnBand() throws {
        let bands = Bands()
        for frequency in [60.0, 440.0, 1_000.0, 6_000.0] {
            let heard = bands.measure(tone(frequency, peak: 0.25), rate: rate)
            let loudest = try #require(heard.levels.indices.max { heard.levels[$0] < heard.levels[$1] })
            let edges = Bands.edges(rate: rate)
            #expect(edges[loudest] <= frequency && frequency < edges[loudest + 1], "\(frequency) Hz")
            #expect(!heard.silent)
        }
    }

    @Test("a louder tone stands taller, and nothing goes past full")
    func aLouderToneStandsTaller() {
        let bands = Bands()
        let quiet = bands.measure(tone(1_000, peak: 0.02), rate: rate).levels.max() ?? 0
        let loud = bands.measure(tone(1_000, peak: 0.3), rate: rate).levels.max() ?? 0
        let clipped = bands.measure(tone(1_000, peak: 1), rate: rate).levels.max() ?? 0
        #expect(quiet > 0 && loud > quiet)
        #expect(clipped <= 1)
    }

    @Test("music at a loud master's level fills the bands to about two thirds, and evenly")
    func pinkNoiseFillsTheBandsEvenly() {
        let levels = Bands().measure(pink(decibels: -14), rate: rate).levels
        let mean = levels.reduce(0, +) / Float(levels.count)
        #expect(mean > 0.5 && mean < 0.8, "mean \(mean)")
        let lowHalf = levels[..<(levels.count / 2)].reduce(0, +)
        let highHalf = levels[(levels.count / 2)...].reduce(0, +)
        #expect(abs(lowHalf - highHalf) / (lowHalf + highHalf) < 0.15, "low \(lowHalf) high \(highHalf)")
    }

    @Test("the bands are spaced as pitch is heard, each wider than the one below")
    func theBandsAreSpacedAsPitch() {
        let edges = Bands.edges(rate: rate)
        #expect(edges.count == Bands.count + 1)
        for index in 1..<(edges.count - 1) {
            #expect(edges[index + 1] - edges[index] > edges[index] - edges[index - 1])
        }
    }
}
