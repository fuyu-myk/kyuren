import Foundation
import Testing

@testable import PerceptionCore

@Suite("Hearing")
struct HearingTests {
    /// The same two tones the training side makes for itself, so its numbers and these must agree.
    private func tone() -> [Float] {
        (0..<(CHUNK * FRAMES)).map { at in
            let t = Double(at) / Double(HEARD_RATE)
            return Float(3000 * sin(2 * .pi * 440 * t) + 1200 * sin(2 * .pi * 1730 * t + 0.3))
        }
    }

    // Training in Python and hearing in Swift compute one chain over the same two model files. If
    // they ever drift apart the wake word is trained on features it will never be given, and no
    // measurement of it means anything. These values were printed by tools/wakeword/features.py.
    @Test("hearing in Swift gives the numbers training gets in Python")
    func hearingInSwiftGivesTheNumbersTrainingGetsInPython() throws {
        let hearing = try Hearing()
        let audio = tone()
        for start in stride(from: 0, to: audio.count, by: CHUNK) {
            try hearing.hear(Array(audio[start..<(start + CHUNK)]))
        }

        // Sixteen chunks are 125 mel frames, which is seven windows of 76 stepping by 8.
        let heard = hearing.heard
        #expect(heard.count == 7)
        let first = try #require(heard.first)
        let last = try #require(heard.last)
        #expect(abs(first[0] - -10.96544) < 0.01)
        #expect(abs(first[1] - 15.88571) < 0.01)
        #expect(abs(first[2] - 12.07613) < 0.01)
        #expect(abs(first[3] - -8.09365) < 0.01)
        #expect(abs(last[0] - -10.91) < 0.01)
        #expect(abs(last[1] - 15.90116) < 0.01)
        #expect(abs(last[2] - 11.96459) < 0.01)
        #expect(abs(last[3] - -8.16675) < 0.01)
        #expect(abs(heard.flatMap { $0 }.reduce(0, +) - 880.633) < 0.5)
    }

    @Test("nothing is judged until there is enough to judge")
    func nothingIsJudgedUntilThereIsEnoughToJudge() throws {
        let hearing = try Hearing()
        let audio = tone()
        for start in stride(from: 0, to: CHUNK * 8, by: CHUNK) {
            try hearing.hear(Array(audio[start..<(start + CHUNK)]))
        }
        #expect(hearing.recent == nil)
    }

    @Test("one chunk becomes one more embedding once the chain is primed")
    func oneChunkBecomesOneMoreEmbeddingOnceTheChainIsPrimed() throws {
        let hearing = try Hearing()
        let audio = tone() + tone()
        for start in stride(from: 0, to: audio.count, by: CHUNK) {
            try hearing.hear(Array(audio[start..<(start + CHUNK)]))
        }
        let before = try #require(hearing.recent)
        try hearing.hear(Array(audio[0..<CHUNK]))
        let after = try #require(hearing.recent)
        #expect(after.count == FRAMES)
        #expect(after[FRAMES - 2] == before[FRAMES - 1], "the window slid by exactly one")
    }
}
