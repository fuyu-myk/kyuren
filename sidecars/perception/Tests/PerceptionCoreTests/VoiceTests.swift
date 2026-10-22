import Foundation
import Testing

@testable import PerceptionCore

/// Keeps the names of what the voice says it is doing.
private final class Told: Transport, @unchecked Sendable {
    private let lock = NSLock()
    private var names: [String] = []

    func send(_ message: Outbound) {
        if case .event(let name, _) = message { lock.withLock { names.append(name) } }
    }

    var events: [String] { lock.withLock { names } }
}

/// Stands in for the synthesiser: every sentence becomes ten milliseconds of near silence, and what
/// it was asked to say is kept.
private final class Rendered: @unchecked Sendable {
    private let lock = NSLock()
    private var texts: [String] = []

    var asked: [String] { lock.withLock { texts } }

    func render(_ text: String) -> (samples: [Float], acousticMs: Double) {
        lock.withLock { texts.append(text) }
        return ([Float](repeating: 0.001, count: 240), 1)
    }
}

private func eventually(_ holds: () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(5)
    while Date() < deadline {
        if holds() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return holds()
}

@Suite("Voice")
struct VoiceTests {
    private let first = "Your first meeting is at nine with the design team."
    private let second = "The afternoon is completely free."

    @Test("a reply said as it arrives is one utterance, finished only once its end is said and heard")
    func saidAsItArrives() async {
        let told = Told()
        let rendered = Rendered()
        let voice = Voice(transport: told, rendering: { rendered.render($0) })

        voice.add(first)
        voice.add(second)
        #expect(await eventually { rendered.asked == [first, second] })
        try? await Task.sleep(for: .milliseconds(200))
        #expect(!told.events.contains("voice.finished"), "more may yet come, however long it takes")

        voice.end()
        #expect(await eventually { told.events.contains("voice.finished") })
        #expect(told.events.filter { $0 == "voice.started" }.count == 1, "one utterance, begun once")
        #expect(voice.lastSpoken == "\(first) \(second)")
    }

    @Test("what is added after what was being said was stopped begins anew")
    func addedAfterStopping() async {
        let told = Told()
        let rendered = Rendered()
        let voice = Voice(transport: told, rendering: { rendered.render($0) })

        voice.add(first)
        voice.stop()
        voice.add(second)
        voice.end()
        #expect(await eventually { told.events.contains("voice.finished") })
        #expect(rendered.asked.last == second)
        #expect(voice.lastSpoken == second, "what was stopped is no longer what was said")
    }

    @Test("saying a whole reply is adding it and ending it")
    func sayingWhole() async {
        let told = Told()
        let rendered = Rendered()
        let voice = Voice(transport: told, rendering: { rendered.render($0) })

        voice.say("\(first) \(second)")
        #expect(await eventually { told.events.contains("voice.finished") })
        #expect(rendered.asked == [first, second])
    }
}
