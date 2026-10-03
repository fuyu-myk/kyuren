import Foundation

/// A guard against Kyuren answering itself.
///
/// The microphone leaks some of the reply back, so an utterance can begin with words Kyuren just
/// said and end with what the user actually asked. What separates the two is not how many words
/// they share but whether they run consecutively: a reply comes back in a stretch, while a
/// question happens to reuse ordinary words.
///
/// Counting shared words alone discarded "What do I have tomorrow?" against a brief containing
/// "have" and "tomorrow", which is the user's question thrown away. Measured on real transcripts,
/// questions run to two words of the reply at most and echoes to five or more.
public enum Echo {
    private static let run = 4

    public static func words(of text: String) -> [String] {
        text.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
    }

    /// The longest stretch the two have in common, in words.
    public static func sharedRun(heard: [String], said: [String]) -> Int {
        guard !heard.isEmpty, !said.isEmpty else { return 0 }

        var previous = [Int](repeating: 0, count: said.count + 1)
        var longest = 0

        for word in heard {
            var current = [Int](repeating: 0, count: said.count + 1)
            for (index, other) in said.enumerated() where word == other {
                current[index + 1] = previous[index] + 1
                longest = max(longest, current[index + 1])
            }
            previous = current
        }

        return longest
    }

    public static func isEcho(heard: String, justSaid: String) -> Bool {
        sharedRun(heard: words(of: heard), said: words(of: justSaid)) >= run
    }
}
