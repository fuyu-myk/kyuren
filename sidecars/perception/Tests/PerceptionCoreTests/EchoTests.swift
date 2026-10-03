import Testing

@testable import PerceptionCore

@Suite("Echo")
struct EchoTests {
    /// A brief of the kind Kyuren says, so the cases below are the ones that occur.
    private let spoken = """
        Today is Tuesday 15 September. You have BIO215 at 9:30 am, CHM118 discussion at 11 am, \
        and CHM118 at 2 pm. 4 deadlines are coming up. The nearest is Stats midterm I Wednesday 23 \
        September at 8 pm, in 8 days. Tomorrow you have BIO104 at 8 am and MAT210 at 2 pm. \
        You have 2 unread messages, from Google Cloud and Northwind Insurance.
        """

    @Test("the question that was thrown away is kept")
    func theQuestionThatWasThrownAwayIsKept() {
        // Shares "i", "have" and "tomorrow" with the reply, and counting shared words discarded it.
        #expect(!Echo.isEcho(heard: "What do I have tomorrow?", justSaid: spoken))
    }

    @Test("ordinary follow-ups are not echoes")
    func ordinaryFollowUpsAreNotEchoes() {
        for asked in [
            "what's on today",
            "and what about thursday",
            "do I have anything at 2 pm",
            "stop, tell me about next week",
            "no, cancel that",
        ] {
            #expect(!Echo.isEcho(heard: asked, justSaid: spoken), "discarded: \(asked)")
        }
    }

    @Test("a stretch of the reply coming back is an echo")
    func aStretchOfTheReplyComingBackIsAnEcho() {
        for heard in [
            "today is tuesday fifteenth september you have BIO215 at nine thirty",
            "Tomorrow you have BIO104 at 8 am and MAT210 at 2 pm",
            "you have 2 unread messages from Google Cloud and Northwind Insurance",
            "the nearest is Stats midterm I wednesday 23 september at 8 pm",
        ] {
            #expect(Echo.isEcho(heard: heard, justSaid: spoken), "answered its own words: \(heard)")
        }
    }

    @Test("the whole reply heard back is an echo")
    func theWholeReplyHeardBackIsAnEcho() {
        #expect(Echo.isEcho(heard: spoken, justSaid: spoken))
    }

    @Test("nothing is an echo of silence")
    func nothingIsAnEchoOfSilence() {
        #expect(!Echo.isEcho(heard: "anything at all", justSaid: ""))
        #expect(!Echo.isEcho(heard: "", justSaid: spoken))
    }

    @Test("the shared stretch is consecutive, not scattered")
    func theSharedStretchIsConsecutiveNotScattered() {
        let said = Echo.words(of: "one two three four five six")
        #expect(Echo.sharedRun(heard: Echo.words(of: "three four five"), said: said) == 3)
        #expect(Echo.sharedRun(heard: Echo.words(of: "six four two"), said: said) == 1,
                "the same words out of order are not a stretch of the reply")
    }

    @Test("words are compared without punctuation or case")
    func wordsAreComparedWithoutPunctuationOrCase() {
        #expect(Echo.words(of: "You have BIO215, at 9:30 am!")
            == ["you", "have", "bio215", "at", "9", "30", "am"])
    }
}
