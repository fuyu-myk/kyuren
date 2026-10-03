public typealias Handler = @Sendable ([String: JSONValue]) throws -> JSONValue

/// A handler whose work is long enough that waiting on it would hold up every request behind it:
/// a download, say. Requests are read one at a time, and voice and the wake word are among them,
/// so this one runs on its own and its answer is sent whenever it is ready.
public typealias LaterHandler = @Sendable ([String: JSONValue]) async throws -> JSONValue

public struct Dispatcher {
    private var handlers: [String: Handler] = [:]
    private var later: [String: LaterHandler] = [:]
    private let transport: any Transport

    public init(transport: any Transport) {
        self.transport = transport
    }

    public mutating func register(_ method: String, _ handler: @escaping Handler) {
        handlers[method] = handler
    }

    public mutating func registerLater(_ method: String, _ handler: @escaping LaterHandler) {
        later[method] = handler
    }

    public func handle(_ line: String) {
        switch parseRequest(line) {
        case .failure(let failure):
            if let id = failure.id {
                transport.send(.failure(id: id, code: ErrorCode.invalidParams, message: failure.reason))
            } else {
                transport.send(.event(name: "sidecar.malformed", data: .object(["reason": .string(failure.reason)])))
            }

        case .success(let request):
            if let handler = later[request.method] {
                let transport = self.transport
                Task {
                    do {
                        transport.send(.success(id: request.id, result: try await handler(request.params)))
                    } catch {
                        transport.send(.failure(
                            id: request.id,
                            code: ErrorCode.`internal`,
                            message: String(describing: error)
                        ))
                    }
                }
                return
            }
            guard let handler = handlers[request.method] else {
                transport.send(.failure(
                    id: request.id,
                    code: ErrorCode.methodNotFound,
                    message: "no handler for \(request.method)"
                ))
                return
            }
            do {
                transport.send(.success(id: request.id, result: try handler(request.params)))
            } catch {
                transport.send(.failure(
                    id: request.id,
                    code: ErrorCode.`internal`,
                    message: String(describing: error)
                ))
            }
        }
    }
}
