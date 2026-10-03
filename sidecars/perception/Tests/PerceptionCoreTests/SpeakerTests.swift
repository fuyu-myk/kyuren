import Foundation
import Testing

@testable import PerceptionCore

@Suite("Speaker")
struct SpeakerTests {
    private let tone = [Float](repeating: 0.1, count: 240)

    @Test("a speaker with nothing to say is idle")
    func aSpeakerWithNothingToSayIsIdle() {
        #expect(!Speaker(sampleRate: 24000).isPlaying)
    }

    @Test("a clip counts as playing from the moment it is handed over")
    func aClipCountsAsPlayingFromTheMomentItIsHandedOver() {
        let speaker = Speaker(sampleRate: 24000)
        speaker.enqueue(tone) {}
        #expect(speaker.isPlaying, "a reply must not look finished before its audio has been heard")
    }

    @Test("a stopped speaker can be used again")
    func aStoppedSpeakerCanBeUsedAgain() {
        let speaker = Speaker(sampleRate: 24000)
        speaker.enqueue(tone) {}
        speaker.stop()

        speaker.enqueue(tone) {}
        #expect(speaker.isPlaying, "dismissing a reply must not leave the speaker unusable")
    }
}
