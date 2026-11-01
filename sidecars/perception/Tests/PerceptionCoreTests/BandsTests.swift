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
        #expect(heard.response.count == Bands.detail)
        #expect(heard.response.allSatisfy { $0 == 0 })
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

    @Test("the response, finer than the bands, peaks where a tone is, low notes as much as high")
    func theResponsePeaksAtATone() throws {
        let bands = Bands()
        for frequency in [50.0, 110.0, 440.0, 6_000.0] {
            let response = bands.measure(tone(frequency, peak: 0.25), rate: rate).response
            #expect(response.count == Bands.detail)
            let loudest = try #require(response.indices.max { response[$0] < response[$1] })
            let edges = Bands.edges(rate: rate, count: Bands.detail)
            let place = log(frequency / edges[0]) / log(edges[Bands.detail] / edges[0]) * Double(Bands.detail)
            #expect(abs(Double(loudest) + 0.5 - place) <= 2, "\(frequency) Hz at \(loudest), not near \(place)")
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

    @Test("music at a loud master's level fills the bands to about half, leaving room for a hit, and evenly")
    func pinkNoiseFillsTheBandsEvenly() {
        let heard = Bands().measure(pink(decibels: -14), rate: rate)
        for levels in [heard.levels, heard.response] {
            let mean = levels.reduce(0, +) / Float(levels.count)
            #expect(mean > 0.45 && mean < 0.65, "mean \(mean)")
            let lowHalf = levels[..<(levels.count / 2)].reduce(0, +)
            let highHalf = levels[(levels.count / 2)...].reduce(0, +)
            #expect(abs(lowHalf - highHalf) / (lowHalf + highHalf) < 0.15, "low \(lowHalf) high \(highHalf)")
        }
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
