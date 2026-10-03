import Foundation

private let terminators: Set<Character> = [".", "!", "?", "\n"]
private let shortest = 24

/// Splits text so synthesis can start speaking the first sentence while later ones are still being
/// generated. Very short fragments are folded into the next sentence, because synthesising three
/// words at a time costs more in per-call overhead than it saves in latency.
public func sentences(of text: String) -> [String] {
    var result: [String] = []
    var current = ""

    for character in text {
        current.append(character)
        guard terminators.contains(character) else { continue }

        let trimmed = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count >= shortest {
            result.append(trimmed)
            current = ""
        }
    }

    let tail = current.trimmingCharacters(in: .whitespacesAndNewlines)
    if !tail.isEmpty {
        if tail.count < shortest, let last = result.popLast() {
            result.append("\(last) \(tail)")
        } else {
            result.append(tail)
        }
    }

    return result
}
