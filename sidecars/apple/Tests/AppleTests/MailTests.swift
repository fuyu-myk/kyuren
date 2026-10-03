import Testing

@testable import AppleCore

@Suite("Mail")
struct MailTests {
    private let field = "\u{001F}"
    private let record = "\u{001E}"

    private func line(_ parts: [String]) -> String {
        parts.joined(separator: field) + record
    }

    @Test("a message becomes a subject, a sender and a moment")
    func aMessageBecomesASubjectASenderAndAMoment() {
        let raw = line(["Reading week", "Someone <a@b.com>", "2026", "9", "15", "8", "5"])
        let messages = Mail.parse(raw)

        #expect(messages.count == 1)
        #expect(messages[0].subject == "Reading week")
        #expect(messages[0].from == "Someone <a@b.com>")
        #expect(messages[0].at == "2026-09-15T08:05:00", "single digits are padded, not left bare")
    }

    @Test("several messages are read in order")
    func severalMessagesAreReadInOrder() {
        let raw = line(["First", "a@b.com", "2026", "9", "15", "9", "0"])
            + line(["Second", "c@d.com", "2026", "9", "15", "10", "30"])
        let messages = Mail.parse(raw)

        #expect(messages.map(\.subject) == ["First", "Second"])
        #expect(messages[1].at == "2026-09-15T10:30:00")
    }

    @Test("a subject with commas and quotes survives")
    func aSubjectWithCommasAndQuotesSurvives() {
        let awkward = #"Re: "midterm", tomorrow, 9am"#
        let messages = Mail.parse(line([awkward, "a@b.com", "2026", "9", "15", "9", "0"]))
        #expect(messages[0].subject == awkward)
    }

    @Test("an empty subject is given words")
    func anEmptySubjectIsGivenWords() {
        let messages = Mail.parse(line(["", "a@b.com", "2026", "9", "15", "9", "0"]))
        #expect(messages[0].subject == "no subject")
    }

    @Test("an empty mailbox reads as no messages")
    func anEmptyMailboxReadsAsNoMessages() {
        #expect(Mail.parse("").isEmpty)
    }

    @Test("a malformed record is dropped rather than guessed at")
    func aMalformedRecordIsDroppedRatherThanGuessedAt() {
        let raw = line(["Good", "a@b.com", "2026", "9", "15", "9", "0"])
            + line(["Broken", "c@d.com", "not-a-year", "9", "15", "9", "0"])
        #expect(Mail.parse(raw).map(\.subject) == ["Good"])
    }
}
