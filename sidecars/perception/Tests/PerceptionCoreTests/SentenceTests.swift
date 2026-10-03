import Testing
@testable import PerceptionCore

@Test func plainTextIsOneSentence() {
    #expect(sentences(of: "The calendar is clear until three.") == ["The calendar is clear until three."])
}

@Test func longSentencesSplitSoSpeechCanStartEarly() {
    let text = "Your first meeting is at nine with the design team. "
        + "The afternoon is completely free. "
        + "Two messages need a reply before lunch."
    let parts = sentences(of: text)

    #expect(parts.count == 3)
    #expect(parts[0].hasSuffix("design team."))
    #expect(parts[1].hasSuffix("completely free."))
}

@Test func shortFragmentsFoldIntoTheirNeighbour() {
    let parts = sentences(of: "Yes. No. Your afternoon is completely clear of meetings.")
    #expect(parts.count == 1, "tiny fragments should not become their own synthesis calls")
}

@Test func atrailingFragmentWithoutPunctuationIsKept() {
    let parts = sentences(of: "This first sentence is quite long indeed. and then a tail")
    #expect(parts.count == 1)
    #expect(parts[0].hasSuffix("and then a tail"))
}

@Test func emptyTextProducesNothing() {
    #expect(sentences(of: "   \n  ").isEmpty)
}

@Test func newlinesTerminateLikePunctuation() {
    let parts = sentences(of: "A reasonably long first line of output\nA reasonably long second line")
    #expect(parts.count == 2)
}
