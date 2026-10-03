import EventKit
import Foundation

/// Reading the calendars the Mac already has, whoever they belong to. An account added to the
/// system is readable here without a second authorisation to the service behind it.
public enum Calendars {
    public static func access(_ store: EKEventStore) async -> Bool {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess:
            return true
        case .notDetermined:
            return (try? await store.requestFullAccessToEvents()) ?? false
        default:
            return false
        }
    }

    public static func events(from: Date, to: Date) async throws -> [Entry] {
        let store = EKEventStore()
        guard await access(store) else {
            throw Trouble.refused("calendar access was not granted")
        }

        let calendars = store.calendars(for: .event)
        guard !calendars.isEmpty else { return [] }

        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: calendars)
        return store.events(matching: predicate).map { event in
            Entry(
                collection: event.calendar?.title ?? "Calendar",
                title: event.title ?? "untitled",
                at: stamp(event.startDate, allDay: event.isAllDay),
                timed: !event.isAllDay,
                url: event.url?.absoluteString
            )
        }
    }

    /// An all-day event has no meaningful time of day, and giving it one moves it across midnight
    /// for anyone east or west of where it was created.
    private static func stamp(_ date: Date?, allDay: Bool) -> String {
        guard let date else { return "" }
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = .current
        if allDay {
            formatter.formatOptions = [.withFullDate]
        } else {
            formatter.formatOptions = [.withInternetDateTime]
        }
        return formatter.string(from: date)
    }
}

public struct Entry: Encodable {
    public let collection: String
    public let title: String
    public let at: String
    public let timed: Bool
    public let url: String?
}

public enum Trouble: Error, CustomStringConvertible {
    case refused(String)
    case badArguments(String)

    public var description: String {
        switch self {
        case .refused(let why): return why
        case .badArguments(let why): return why
        }
    }
}
