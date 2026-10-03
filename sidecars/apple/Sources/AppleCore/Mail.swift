import AppKit
import Foundation

/// Reading unread mail out of Mail.app.
///
/// AppleScript is the only interface Mail offers. Its date values are locale-formatted strings, so
/// the components are read individually and assembled here rather than parsed back out of prose.
public enum Mail {
    static let bundle = "com.apple.mail"

    /// A unit separator and a record separator. Neither occurs in a subject line, which is more
    /// than can be said for commas, tabs and newlines.
    private static let field = "\u{001F}"
    private static let record = "\u{001E}"

    public static func running() -> Bool {
        !NSRunningApplication.runningApplications(withBundleIdentifier: bundle).isEmpty
    }

    public static func unread(limit: Int) throws -> [Message] {
        guard running() else {
            // Asking Mail anything starts it. Opening someone's mail client because they asked what
            // their day looks like is not a reasonable thing to do unprompted.
            throw Trouble.refused("Mail is not running")
        }

        let source = """
        tell application "Mail"
            set output to ""
            set unreadMessages to (messages of inbox whose read status is false)
            set wanted to count of unreadMessages
            if wanted > \(limit) then set wanted to \(limit)
            repeat with index from 1 to wanted
                set note to item index of unreadMessages
                set received to date received of note
                set output to output & (subject of note) & "\(field)" & (sender of note) & "\(field)" ¬
                    & (year of received) & "\(field)" & ((month of received) as integer) & "\(field)" ¬
                    & (day of received) & "\(field)" & (hours of received) & "\(field)" ¬
                    & (minutes of received) & "\(record)"
            end repeat
            return output
        end tell
        """

        var failure: NSDictionary?
        let script = NSAppleScript(source: source)
        let answer = script?.executeAndReturnError(&failure)

        if let failure {
            let said = failure[NSAppleScript.errorMessage] as? String ?? "\(failure)"
            throw Trouble.refused("Mail refused: \(said)")
        }

        return parse(answer?.stringValue ?? "")
    }

    public static func parse(_ raw: String) -> [Message] {
        raw.components(separatedBy: record).compactMap { line in
            let parts = line.components(separatedBy: field)
            guard parts.count >= 7, let year = Int(parts[2]), let month = Int(parts[3]),
                  let day = Int(parts[4]), let hour = Int(parts[5]), let minute = Int(parts[6])
            else { return nil }

            return Message(
                subject: parts[0].isEmpty ? "no subject" : parts[0],
                from: parts[1],
                at: String(
                    format: "%04d-%02d-%02dT%02d:%02d:00", year, month, day, hour, minute)
            )
        }
    }
}

public struct Message: Encodable, Equatable {
    public let subject: String
    public let from: String
    public let at: String
}
