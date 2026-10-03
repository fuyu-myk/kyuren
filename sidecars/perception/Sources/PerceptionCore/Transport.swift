import Foundation

public protocol Transport: Sendable {
    func send(_ message: Outbound)
}

public struct StdioTransport: Transport {
    private let output: FileHandle

    public init(output: FileHandle = .standardOutput) {
        self.output = output
    }

    public func send(_ message: Outbound) {
        guard let data = (message.encoded() + "\n").data(using: .utf8) else { return }
        try? output.write(contentsOf: data)
    }
}
