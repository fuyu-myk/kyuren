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

/// Keeps what the voice says about whether it is speaking, in order.
private final class Announced: @unchecked Sendable {
    private let lock = NSLock()
    private var said: [Bool] = []

    func note(_ speaking: Bool) { lock.withLock { said.append(speaking) } }
    var all: [Bool] { lock.withLock { said } }
}

/// Stands in for synthesis on the Neural Engine, which goes on to the end once begun even when
/// what asked for it has been cancelled.
private func stubborn(_ ms: Int) -> Rendering {
    { _ in
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(ms)) { done.resume() }
        }
        return ([Float](repeating: 0.001, count: 2_400), 1)
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

/// Long enough for what was played in a test to be heard out.
private func throughout(_ holds: () -> Bool) async -> Bool {
    let deadline = Date().addingTimeInterval(4)
    while Date() < deadline {
        if !holds() { return false }
        try? await Task.sleep(for: .milliseconds(20))
    }
    return true
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

    @Test("something said in its own right is said whole, and ends")
    func sayingWhole() async {
        let told = Told()
        let rendered = Rendered()
        let voice = Voice(transport: told, rendering: { rendered.render($0) })

        voice.say("\(first) \(second)")
        #expect(await eventually { told.events.contains("voice.finished") })
        #expect(rendered.asked == [first, second])
    }

    @Test("something said in its own right waits for what is being said, which goes on being said")
    func noticeWaits() async {
        let told = Told()
        let rendered = Rendered()
        let voice = Voice(transport: told, rendering: { rendered.render($0) })
        let notice = "Your meeting with the design team starts in five minutes."

        voice.add(first)
        voice.say(notice)
        voice.add(second)
        #expect(await eventually { rendered.asked == [first, second] })
        try? await Task.sleep(for: .milliseconds(200))
        #expect(rendered.asked == [first, second], "the notice waits for the reply to end")

        voice.end()
        #expect(await eventually { rendered.asked == [first, second, notice] })
        #expect(await eventually { told.events.contains("voice.finished") })
    }

    @Test("what is added once a reply has ended is said after it rather than over it")
    func addedAfterEnding() async {
        let told = Told()
        let rendered = Rendered()
        let voice = Voice(transport: told, rendering: { text in
            try await Task.sleep(for: .milliseconds(100))
            return rendered.render(text)
        })

        voice.add(first)
        voice.end()
        voice.add(second)
        voice.end()
        #expect(await eventually { told.events.filter { $0 == "voice.started" }.count == 2 })
        #expect(rendered.asked == [first, second])
        #expect(await eventually { told.events.contains("voice.finished") })
    }

    @Test("a pause between sentences is still speaking, so speaking over it is speaking over the reply")
    func pauseIsSpeaking() async {
        let told = Told()
        let rendered = Rendered()
        let voice = Voice(transport: told, rendering: { rendered.render($0) })

        voice.add(first)
        #expect(await eventually { told.events.contains("voice.started") })
        #expect(await throughout { voice.isSpeaking }, "heard out, with more yet to come")

        voice.end()
        #expect(await eventually { told.events.contains("voice.finished") })
        #expect(!voice.isSpeaking)
    }

    @Test("a stop that catches an utterance waiting for more leaves nothing of it behind")
    func stoppedWhileWaiting() async {
        let told = Told()
        let rendered = Rendered()
        let voice = Voice(transport: told, rendering: { rendered.render($0) })

        voice.add("```")
        try? await Task.sleep(for: .milliseconds(100))
        voice.stop()
        try? await Task.sleep(for: .milliseconds(200))
        #expect(!told.events.contains("voice.failed"), "stopping is not failing")
        #expect(!told.events.contains("voice.finished"))
        #expect(!voice.isSpeaking)
    }

    @Test("utterances still being made when a stop came say nothing of speaking, so what follows is heard as speech")
    func staleSayNothing() async {
        let told = Told()
        let announced = Announced()
        let voice = Voice(transport: told, rendering: stubborn(150))
        voice.whenSpeakingChanges { announced.note($0) }

        voice.add(first)
        voice.say("Your meeting with the design team starts in five minutes.")
        try? await Task.sleep(for: .milliseconds(50))
        voice.stop()
        voice.add(second)
        voice.end()
        #expect(await eventually { told.events.contains("voice.started") })
        #expect(announced.all.last == true, "what is heard is heard as speaking")
        #expect(await eventually { told.events.contains("voice.finished") })
        #expect(announced.all == [true, false, true, false])
    }
}
