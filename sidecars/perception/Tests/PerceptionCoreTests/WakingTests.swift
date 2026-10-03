import Testing

@testable import PerceptionCore

@Suite("Waking")
struct WakingTests {
    private func heard(_ scores: [Double], over threshold: Double = 0.5) -> [Int] {
        var waking = Waking()
        return scores.enumerated().compactMap { at, score in
            waking.heard(score, over: threshold) ? at : nil
        }
    }

    @Test("fewer chunks over the line than needed are not the word")
    func fewerChunksOverTheLineThanNeededAreNotTheWord() {
        let short = [0.1] + [Double](repeating: 0.9, count: NEEDED - 1) + [0.1, 0.1]
        #expect(heard(short).isEmpty)
    }

    @Test("enough chunks in a row over the line are")
    func enoughChunksInARowOverTheLineAre() {
        let enough = [0.1] + [Double](repeating: 0.9, count: NEEDED) + [0.1]
        #expect(heard(enough) == [NEEDED])
    }

    // A word takes more than two chunks to say, and every chunk of it may clear the line. Hearing
    // it once per chunk would summon Kyuren several times for one name.
    @Test("a word said once is heard once")
    func aWordSaidOnceIsHeardOnce() {
        #expect(heard([Double](repeating: 0.9, count: 8)) == [NEEDED - 1])
    }

    @Test("a word said again after a breath is heard again")
    func aWordSaidAgainAfterABreathIsHeardAgain() {
        let word = [Double](repeating: 0.9, count: NEEDED)
        let quiet = [Double](repeating: 0.05, count: REST + 1)
        #expect(heard(word + quiet + word) == [NEEDED - 1, NEEDED + REST + 1 + NEEDED - 1])
    }

    @Test("the line is the line")
    func theLineIsTheLine() {
        #expect(heard([Double](repeating: 0.49, count: NEEDED + 1), over: 0.5).isEmpty)
        #expect(heard([Double](repeating: 0.5, count: NEEDED), over: 0.5) == [NEEDED - 1])
    }

    @Test("a wake counts only while a voice was heard lately")
    func aWakeCountsOnlyWhileAVoiceWasHeardLately() {
        var voiced = Voiced()
        #expect(!voiced.spoken(at: 10), "nobody has spoken yet")

        voiced.heard(speech: true, at: 10)
        #expect(voiced.spoken(at: 10.5))
        #expect(voiced.spoken(at: 10 + SPOKEN_WITHIN))
        #expect(!voiced.spoken(at: 10 + SPOKEN_WITHIN + 0.1), "the phrase is over by then")

        voiced.heard(speech: false, at: 20)
        #expect(!voiced.spoken(at: 20), "silence does not count as a voice")
    }
}
