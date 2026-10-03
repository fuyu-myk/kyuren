import Foundation

public enum ErrorCode {
    public static let methodNotFound = "method_not_found"
    public static let invalidParams = "invalid_params"
    public static let `internal` = "internal"
}

public struct Request: Sendable, Equatable {
    public let id: String
    public let method: String
    public let params: [String: JSONValue]
}

public struct ParseFailure: Error, Sendable, Equatable {
    public let id: String?
    public let reason: String
}

public enum Outbound: Sendable, Equatable {
    case success(id: String, result: JSONValue)
    case failure(id: String, code: String, message: String)
    case event(name: String, data: JSONValue?)

    public func encoded() -> String {
        let object: [String: JSONValue]
        switch self {
        case .success(let id, let result):
            object = ["id": .string(id), "ok": .bool(true), "result": result]
        case .failure(let id, let code, let message):
            object = [
                "id": .string(id),
                "ok": .bool(false),
                "error": .object(["code": .string(code), "message": .string(message)]),
            ]
        case .event(let name, let data):
            var fields: [String: JSONValue] = ["event": .string(name)]
            if let data { fields["data"] = data }
            object = fields
        }
        guard let bytes = try? JSONEncoder().encode(object),
              let line = String(data: bytes, encoding: .utf8)
        else {
            return #"{"event":"sidecar.malformed","data":{"reason":"response could not be encoded"}}"#
        }
        return line
    }
}

public func parseRequest(_ line: String) -> Result<Request, ParseFailure> {
    guard let data = line.data(using: .utf8),
          let decoded = try? JSONDecoder().decode(JSONValue.self, from: data)
    else {
        return .failure(ParseFailure(id: nil, reason: "line is not valid JSON"))
    }
    guard case .object(let fields) = decoded else {
        return .failure(ParseFailure(id: nil, reason: "message is not an object"))
    }

    var id: String?
    if case .string(let value)? = fields["id"] { id = value }

    guard case .string(let method)? = fields["method"] else {
        return .failure(ParseFailure(id: id, reason: "message has no method"))
    }
    guard let id else {
        return .failure(ParseFailure(id: nil, reason: "request has no string id"))
    }

    switch fields["params"] {
    case .none, .null:
        return .success(Request(id: id, method: method, params: [:]))
    case .object(let params)?:
        return .success(Request(id: id, method: method, params: params))
    default:
        return .failure(ParseFailure(id: id, reason: "params is not an object"))
    }
}
