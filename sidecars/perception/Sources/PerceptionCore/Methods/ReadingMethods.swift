import Foundation

public func readingHandlers() -> [String: LaterHandler] {
    [
        "pdf.read": { params in
            guard case .string(let address)? = params["url"], let url = URL(string: address) else {
                throw PDFReadingError.notAnAddress
            }
            var from = 1
            if case .number(let page)? = params["from"], page >= 1 { from = Int(page) }
            // Never straight out: without the host's proxy there is no look at where a name leads.
            guard case .number(let port)? = params["proxy"], (1...65535).contains(port),
                  case .string(let user)? = params["proxyUser"], case .string(let password)? = params["proxyPassword"]
            else {
                throw PDFReadingError.unproxied
            }
            let read = try await readPDF(at: url, from: from, through: ProxyAccess(port: UInt16(port), user: user, password: password))
            return .object([
                "title": .string(read.title),
                "text": .string(read.text),
                "pages": .number(Double(read.pages)),
                "read": .number(Double(read.read)),
            ])
        },
    ]
}
