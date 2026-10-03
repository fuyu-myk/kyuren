import AppleCore
import EventKit
import Foundation

/// A short-lived helper rather than a fourth long-running process. It is asked one question, it
/// answers on standard output as JSON, and it exits.
func fail(_ reason: String) -> Never {
    let payload = ["error": reason]
    if let data = try? JSONEncoder().encode(payload), let text = String(data: data, encoding: .utf8) {
        print(text)
    }
    exit(1)
}

func value(for flag: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: flag),
          index + 1 < CommandLine.arguments.count
    else { return nil }
    return CommandLine.arguments[index + 1]
}

func day(_ text: String?, fallback: Date) -> Date {
    guard let text else { return fallback }
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = .current
    return formatter.date(from: text) ?? fallback
}

let command = CommandLine.arguments.dropFirst().first ?? "help"

switch command {
case "calendar":
    let from = day(value(for: "--from"), fallback: Date())
    let to = day(value(for: "--to"), fallback: Date().addingTimeInterval(86_400 * 7))

    do {
        let entries = try await Calendars.events(from: from, to: to.addingTimeInterval(86_399))
        let data = try JSONEncoder().encode(entries)
        print(String(data: data, encoding: .utf8) ?? "[]")
    } catch {
        fail(String(describing: error))
    }

case "mail":
    let limit = Int(value(for: "--limit") ?? "12") ?? 12
    do {
        let messages = try Mail.unread(limit: max(1, min(limit, 50)))
        let data = try JSONEncoder().encode(messages)
        print(String(data: data, encoding: .utf8) ?? "[]")
    } catch {
        fail(String(describing: error))
    }

case "access":
    let status = EKEventStore.authorizationStatus(for: .event)
    let names: [EKAuthorizationStatus: String] = [
        .notDetermined: "undetermined", .restricted: "restricted",
        .denied: "denied", .fullAccess: "authorized", .writeOnly: "write only",
    ]
    print("{\"calendar\":\"\(names[status] ?? "unknown")\",\"mail\":\"\(Mail.running() ? "running" : "not running")\"}")

default:
    fail("usage: kyuren-apple calendar --from YYYY-MM-DD --to YYYY-MM-DD | mail --limit N | access")
}
