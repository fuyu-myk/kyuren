import Foundation
import Testing
@testable import PerceptionCore

private final class Collector: Transport, @unchecked Sendable {
    private let lock = NSLock()
    private var messages: [Outbound] = []

    func send(_ message: Outbound) {
        lock.withLock { messages.append(message) }
    }

    var sent: [Outbound] {
        lock.withLock { messages }
    }
}

private struct Boom: Error {}

private func dispatched(_ body: (inout Dispatcher) -> Void) -> [Outbound] {
    let collector = Collector()
    var subject = Dispatcher(transport: collector)
    body(&subject)
    return collector.sent
}

@Test func knownMethodAnswersWithItsResult() {
    let sent = dispatched { subject in
        subject.register("echo") { params in .object(params) }
        subject.handle(#"{"id":"a","method":"echo","params":{"n":1}}"#)
    }

    #expect(sent == [.success(id: "a", result: .object(["n": .number(1)]))])
}

@Test func unknownMethodAnswersRatherThanHanging() {
    let sent = dispatched { subject in
        subject.handle(#"{"id":"b","method":"absent"}"#)
    }

    #expect(sent == [.failure(id: "b", code: "method_not_found", message: "no handler for absent")])
}

@Test func throwingHandlerProducesErrorResponseNotSilence() {
    let sent = dispatched { subject in
        subject.register("boom") { _ in throw Boom() }
        subject.handle(#"{"id":"c","method":"boom"}"#)
    }

    #expect(sent.count == 1)
    guard case .failure(let id, let code, _) = sent.first else {
        Issue.record("expected a failure response")
        return
    }
    #expect(id == "c")
    #expect(code == "internal")
}

@Test func malformedLineWithoutIdEmitsEventAndIsDiscarded() {
    let sent = dispatched { subject in
        subject.handle("this is not json")
    }

    #expect(sent == [
        .event(name: "sidecar.malformed", data: .object(["reason": .string("line is not valid JSON")]))
    ])
}

@Test func malformedRequestWithIdAnswersOnThatId() {
    let sent = dispatched { subject in
        subject.handle(#"{"id":"d","method":"echo","params":7}"#)
    }

    #expect(sent == [.failure(id: "d", code: "invalid_params", message: "params is not an object")])
}

@Test func absentParamsAreTreatedAsEmpty() {
    let sent = dispatched { subject in
        subject.register("echo") { params in .number(Double(params.count)) }
        subject.handle(#"{"id":"e","method":"echo"}"#)
    }

    #expect(sent == [.success(id: "e", result: .number(0))])
}


@Test func aSlowHandlerAnswersLaterWithoutHoldingUpTheRequestsBehindIt() async throws {
    let collector = Collector()
    var subject = Dispatcher(transport: collector)
    subject.registerLater("slow") { _ in
        try await Task.sleep(for: .milliseconds(150))
        return .string("done")
    }
    subject.registerLater("broken") { _ in throw Boom() }
    subject.register("echo") { params in .object(params) }

    subject.handle(#"{"id":"s","method":"slow"}"#)
    subject.handle(#"{"id":"e","method":"echo","params":{"n":1}}"#)
    #expect(collector.sent.first == .success(id: "e", result: .object(["n": .number(1)])), "the quick one is answered first")

    subject.handle(#"{"id":"b","method":"broken"}"#)
    try await Task.sleep(for: .milliseconds(400))
    #expect(collector.sent.contains(.success(id: "s", result: .string("done"))))
    #expect(collector.sent.contains { if case .failure(let id, _, _) = $0 { return id == "b" } else { return false } })
}
