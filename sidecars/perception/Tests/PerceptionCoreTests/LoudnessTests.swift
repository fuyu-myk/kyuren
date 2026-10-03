import Foundation
import Testing

@testable import PerceptionCore

@Suite("Loudness")
struct LoudnessTests {
    private func rms(_ samples: [Float]) -> Float {
        (samples.reduce(0) { $0 + $1 * $1 } / Float(samples.count)).squareRoot()
    }

    private func tone(peak: Float, count: Int = 24_000) -> [Float] {
        (0..<count).map { peak * sin(Float($0) * 0.05) }
    }

    @Test("a quiet clip is brought up to speaking level")
    func aQuietClipIsBroughtUpToSpeakingLevel() {
        let quiet = tone(peak: 0.06)
        let raised = louder(quiet)
        #expect(rms(raised) > rms(quiet) * 2)
        #expect(abs(rms(raised) - 0.126) < 0.01)
    }

    @Test("no sample is ever pushed past the ceiling, whatever that costs in loudness")
    func noSampleIsEverPushedPastTheCeiling() {
        // Mostly silence with one sharp spike: the average is tiny, so the gain wanted is large,
        // and the spike is what stops it.
        var spiky = [Float](repeating: 0.001, count: 24_000)
        spiky[100] = 0.5
        let raised = louder(spiky)
        #expect(raised.reduce(0) { max($0, abs($1)) } <= 0.98)
        #expect(raised[100] > spiky[100])
    }

    @Test("a clip already loud enough is left exactly as it is")
    func aClipAlreadyLoudEnoughIsLeftExactlyAsItIs() {
        let loud = tone(peak: 0.9)
        #expect(louder(loud) == loud)
    }

    @Test("silence stays silence")
    func silenceStaysSilence() {
        let silence = [Float](repeating: 0, count: 1000)
        #expect(louder(silence) == silence)
        #expect(louder([]) == [])
    }

    @Test("the shape of the clip is not changed, only its size")
    func theShapeOfTheClipIsNotChangedOnlyItsSize() {
        let quiet = tone(peak: 0.05)
        let raised = louder(quiet)
        let ratio = raised[10] / quiet[10]
        for at in stride(from: 1, to: quiet.count, by: 997) {
            #expect(abs(raised[at] / quiet[at] - ratio) < 1e-4)
        }
    }
}
