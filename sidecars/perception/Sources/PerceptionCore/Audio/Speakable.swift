import Foundation

/// Strips markup a speech synthesiser cannot pronounce.
///
/// Local models answer in markdown whether or not they are asked to. Read aloud that is wrong even
/// when it works, and the grapheme-to-phoneme stage fails outright on some of it, which used to
/// strand the whole utterance when the failure landed on the last sentence.
public func speakable(_ text: String) -> String {
    var work = text

    work = work.replacingOccurrences(
        of: "```[\\s\\S]*?```", with: " ", options: .regularExpression)
    work = work.replacingOccurrences(
        of: "~~~[\\s\\S]*?~~~", with: " ", options: .regularExpression)
    work = work.replacingOccurrences(of: "`([^`]*)`", with: "$1", options: .regularExpression)

    work = work.replacingOccurrences(
        of: "!\\[[^\\]]*\\]\\([^)]*\\)", with: " ", options: .regularExpression)
    work = work.replacingOccurrences(
        of: "\\[([^\\]]*)\\]\\([^)]*\\)", with: "$1", options: .regularExpression)

    work = work.replacingOccurrences(
        of: "^\\s{0,3}#{1,6}\\s*", with: "", options: [.regularExpression])
    work = work.replacingOccurrences(
        of: "(?m)^\\s{0,3}#{1,6}\\s*", with: "", options: .regularExpression)
    work = work.replacingOccurrences(
        of: "(?m)^\\s{0,3}>\\s?", with: "", options: .regularExpression)
    work = work.replacingOccurrences(
        of: "(?m)^\\s*[-*+]\\s+", with: "", options: .regularExpression)
    work = work.replacingOccurrences(
        of: "(?m)^\\s*\\d+[.)]\\s+", with: "", options: .regularExpression)
    work = work.replacingOccurrences(
        of: "(?m)^\\s*([-*_]\\s*){3,}$", with: " ", options: .regularExpression)

    work = work.replacingOccurrences(of: "\\*\\*([^*]+)\\*\\*", with: "$1", options: .regularExpression)
    work = work.replacingOccurrences(of: "__([^_]+)__", with: "$1", options: .regularExpression)
    work = work.replacingOccurrences(of: "\\*([^*\\n]+)\\*", with: "$1", options: .regularExpression)
    work = work.replacingOccurrences(of: "(?<![A-Za-z0-9])_([^_\\n]+)_(?![A-Za-z0-9])", with: "$1", options: .regularExpression)
    work = work.replacingOccurrences(of: "~~([^~]+)~~", with: "$1", options: .regularExpression)

    // Table pipes read as nothing useful, and the cells are usually fragments.
    work = work.replacingOccurrences(of: "(?m)^\\s*\\|.*\\|\\s*$", with: " ", options: .regularExpression)

    // Anything left that is not speech: stray markup and symbols the phonemiser rejects.
    work = work.replacingOccurrences(of: "[*_`#>|\\\\<>{}\\[\\]]", with: " ", options: .regularExpression)

    work = work.replacingOccurrences(of: "[ \\t]+", with: " ", options: .regularExpression)
    work = work.replacingOccurrences(of: "(?m)^ +| +$", with: "", options: .regularExpression)
    work = work.replacingOccurrences(of: "\n{2,}", with: "\n", options: .regularExpression)

    return work.trimmingCharacters(in: .whitespacesAndNewlines)
}
