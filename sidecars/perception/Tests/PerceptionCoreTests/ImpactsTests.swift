import Foundation
import Testing

@testable import PerceptionCore

@Suite("Impacts")
struct ImpactsTests {
    /// A measure's worth of time at thirty a second.
    private let interval = 1.0 / 30

    /// A window of steady noise at a root mean square in dBFS.
    private func noise(decibels: Float) -> [Float] {
        let peak = pow(10, decibels / 20) * Float(3).squareRoot()
        return (0..<Bands.size).map { _ in Float.random(in: -peak...peak) }
    }

    /// The window as it stands when a hit this loud has just landed in its newest samples.
    private func hit(_ decibels: Float, over music: Float) -> [Float] {
        let before = noise(decibels: music)
        let after = noise(decibels: decibels)
        return Array(before.prefix(Bands.size - Impacts.moment) + after.suffix(Impacts.moment))
    }

    private func steady(_ impacts: Impacts, decibels: Float, seconds: Double) -> [Float] {
        (0..<Int(seconds / interval)).map { _ in impacts.hear(noise(decibels: decibels), after: interval) }
    }

    @Test("music that is merely loud, however loud, never lands as a hit")
    func steadyMusicNeverHits() {
        let impacts = Impacts()
        let heard = steady(impacts, decibels: -6, seconds: 3)
        #expect(heard.allSatisfy { $0 == 0 }, "\(heard.max() ?? 0)")
    }

    @Test("a hit well over the music before it lands in full, and a smaller one in part")
    func aHitOverTheMusicLands() {
        let impacts = Impacts()
        _ = steady(impacts, decibels: -24, seconds: 2)
        #expect(impacts.hear(hit(-8, over: -24), after: interval) == 1)

        let again = Impacts()
        _ = steady(again, decibels: -24, seconds: 2)
        let part = again.hear(hit(-18, over: -24), after: interval)
        #expect(part > 0.1 && part < 0.8, "\(part)")
    }

    @Test("music swelling slowly is followed rather than hit by")
    func aSwellIsNotAHit() {
        let impacts = Impacts()
        var heard: [Float] = []
        for step in 0..<90 {
            heard.append(impacts.hear(noise(decibels: -30 + Float(step) * 0.1), after: interval))
        }
        #expect(heard.allSatisfy { $0 == 0 }, "\(heard.max() ?? 0)")
    }

    @Test("music starting out of silence, or the first window heard, is not a hit")
    func aStartIsNotAHit() {
        let impacts = Impacts()
        #expect(impacts.hear(noise(decibels: -8), after: interval) == 0)

        let quiet = Impacts()
        _ = steady(quiet, decibels: -70, seconds: 1)
        let starting = [quiet.hear(hit(-8, over: -70), after: interval)] + steady(quiet, decibels: -8, seconds: 1)
        #expect(starting.allSatisfy { $0 == 0 }, "\(starting.prefix(4))")

        let reset = Impacts()
        _ = steady(reset, decibels: -40, seconds: 1)
        reset.reset()
        #expect(reset.hear(noise(decibels: -8), after: interval) == 0)
    }
}
