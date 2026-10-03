import AVFoundation
import Foundation
import Testing

@testable import PerceptionCore

@Suite("Wake word")
struct WakeWordTests {
    /// A held out voice saying the phrase, read from the fixture on the scale the chain hears at.
    private func phrase() throws -> [Float] {
        let at = try #require(
            Bundle.module.url(forResource: "hey_kyuren_af_sky", withExtension: "wav", subdirectory: "Fixtures")
        )
        let file = try AVAudioFile(forReading: at)
        let buffer = try #require(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)))
        try file.read(into: buffer)
        let samples = try #require(buffer.floatChannelData?[0])
        #expect(file.processingFormat.sampleRate == Double(HEARD_RATE))
        return (0..<Int(buffer.frameLength)).map { samples[$0] * 32767 }
    }

    private func scores(_ audio: [Float]) throws -> [Double] {
        let hearing = try Hearing()
        var got: [Double] = []
        for start in stride(from: 0, to: audio.count - CHUNK + 1, by: CHUNK) {
            try hearing.hear(Array(audio[start..<(start + CHUNK)]))
            if let recent = hearing.recent { got.append(try hearing.judge(recent)) }
        }
        return got
    }

    @Test("the wake word ships with the sidecar")
    func theWakeWordShipsWithTheSidecar() throws {
        #expect(try Hearing().trained)
    }

    // The whole point, end to end: the phrase in a voice the head never trained on, through the
    // same chain the microphone feeds, is heard, and heard once.
    @Test("a voice it has never heard saying the phrase is heard, once")
    func aVoiceItHasNeverHeardSayingThePhraseIsHeardOnce() throws {
        let got = try scores(try phrase())
        #expect(try #require(got.max()) > 0.5)

        var waking = Waking()
        let heard = got.filter { waking.heard($0, over: 0.5) }.count
        #expect(heard == 1)
    }

    @Test("noise is not the phrase")
    func noiseIsNotThePhrase() throws {
        var seed: UInt64 = 7
        let noise = (0..<(CHUNK * 40)).map { _ -> Float in
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Float(Int64(seed >> 33) % 6000) - 3000
        }
        let got = try scores(noise)
        #expect(try #require(got.max()) < 0.5)
    }
}
