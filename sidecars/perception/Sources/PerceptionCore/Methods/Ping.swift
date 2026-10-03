import Foundation

private let startedAt = Date()

public func ping(_ params: [String: JSONValue]) throws -> JSONValue {
    _ = params
    return .object([
        "name": .string("perception"),
        "version": .string("0.0.0"),
        "uptimeMs": .number((Date().timeIntervalSince(startedAt) * 1000).rounded()),
    ])
}
