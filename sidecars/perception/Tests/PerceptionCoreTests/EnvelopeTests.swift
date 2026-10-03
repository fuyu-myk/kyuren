import Foundation
import Testing

@testable import PerceptionCore

@Suite("Envelope")
struct EnvelopeTests {
    private let rate = 24000.0

    private func frames(_ count: Int) -> Int {
        Int(rate * envelopeFrame) * count
    }

    @Test("one reading covers one frame of audio")
    func oneReadingCoversOneFrame() {
        let measured = envelope(of: [Float](repeating: 0.2, count: frames(5)), sampleRate: rate)
        #expect(measured.count == 5)
    }

    @Test("a partial last frame is still measured")
    func aPartialLastFrameIsStillMeasured() {
        let measured = envelope(of: [Float](repeating: 0.2, count: frames(2) + 10), sampleRate: rate)
        #expect(measured.count == 3)
    }

    @Test("silence reads lower than speech")
    func silenceReadsLowerThanSpeech() {
        let quiet = envelope(of: [Float](repeating: 0.0001, count: frames(1)), sampleRate: rate)
        let loud = envelope(of: [Float](repeating: 0.5, count: frames(1)), sampleRate: rate)
        #expect(quiet[0] < 0.05)
        #expect(loud[0] > 0.9)
    }

    @Test("an empty clip has no readings")
    func anEmptyClipHasNoReadings() {
        #expect(envelope(of: [], sampleRate: rate).isEmpty)
    }

    @Test("a moment reads the frame it falls in")
    func aMomentReadsTheFrameItFallsIn() {
        let measured: [Float] = [0.1, 0.5, 0.9]
        #expect(reading(measured, at: 0) == 0.1)
        #expect(reading(measured, at: envelopeFrame * 1.5) == 0.5)
    }

    @Test("running past the end holds the last reading")
    func runningPastTheEndHoldsTheLastReading() {
        let measured: [Float] = [0.1, 0.5, 0.9]
        #expect(reading(measured, at: 99) == 0.9)
        #expect(reading([], at: 1) == 0)
    }
}
