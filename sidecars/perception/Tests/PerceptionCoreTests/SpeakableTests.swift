import Testing
@testable import PerceptionCore

@Test func plainProseIsLeftAlone() {
    let text = "Your first meeting is at nine with the design team."
    #expect(speakable(text) == text)
}

@Test func emphasisLosesItsMarkersButKeepsItsWords() {
    #expect(speakable("You have **three** meetings and *one* call.") == "You have three meetings and one call.")
    #expect(speakable("That is __important__ and _urgent_.") == "That is important and urgent.")
}

@Test func headingsBecomeTheirText() {
    #expect(speakable("## Today\nTwo meetings.") == "Today\nTwo meetings.")
}

@Test func bulletsLoseTheirMarkers() {
    let spoken = speakable("- Call Sam\n- Send the invoice")
    #expect(spoken == "Call Sam\nSend the invoice")
}

@Test func numberedItemsLoseTheirMarkers() {
    #expect(speakable("1. First thing\n2. Second thing") == "First thing\nSecond thing")
}

@Test func codeFencesAreDroppedEntirely() {
    let spoken = speakable("Run this:\n```bash\nrm -rf /\n```\nThen tell me.")
    #expect(!spoken.contains("rm -rf"))
    #expect(spoken.contains("Then tell me."))
}

@Test func inlineCodeKeepsItsContent() {
    #expect(speakable("Open `notes.md` please.") == "Open notes.md please.")
}

@Test func linksReadAsTheirLabel() {
    #expect(speakable("See [the agenda](https://example.com/a/b) first.") == "See the agenda first.")
}

@Test func tablesAreDropped() {
    let spoken = speakable("Here:\n| When | What |\n| --- | --- |\n| Nine | Design |\nThat is all.")
    #expect(!spoken.contains("|"))
    #expect(spoken.contains("That is all."))
}

@Test func noMarkupSurvivesAnywhere() {
    let messy = """
    # Heading
    Some **bold**, some `code`, a [link](http://x.y), and a list:
    - one
    * two
    > quoted
    ---
    """
    let spoken = speakable(messy)
    for symbol in ["#", "*", "`", "[", "]", "(", ">", "_", "|"] where symbol != "(" && symbol != ")" {
        #expect(!spoken.contains(symbol), "\(symbol) survived: \(spoken)")
    }
}

@Test func aReplyThatIsOnlyMarkupHasNothingToSay() {
    // Correct, not a gap: the caller reports that nothing could be spoken rather than reading
    // punctuation aloud.
    #expect(speakable("```\ncode only\n```").isEmpty)
    #expect(speakable("---").isEmpty)
}
