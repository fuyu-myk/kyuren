import Foundation
import Network
import PDFKit

public enum PDFReadingError: Error, CustomStringConvertible, Equatable {
    case notAnAddress
    case notAPDF
    case unreadable
    case tooLarge
    case refused(Int)
    case nearby
    case unproxied

    public var description: String {
        switch self {
        case .notAnAddress: return "only a web address can be read"
        case .notAPDF: return "that address did not give a PDF"
        case .unreadable: return "the PDF could not be opened"
        case .tooLarge: return "the PDF is larger than will be read"
        case .refused(let status): return "the server answered \(status)"
        case .nearby: return "that address leads to this machine or its network"
        case .unproxied: return "the download was given no proxy to go out through"
        }
    }
}

/// How much of a document is handed back, in characters: a paper's method and results, which is
/// where the details research checks against live, without the whole of a book.
public let PDF_MOST = 32_000

/// The largest file downloaded, and how long a download may sit idle before it is given up.
let PDF_BIGGEST = 40 * 1024 * 1024
let PDF_PATIENCE: TimeInterval = 30

/// The same browser the reader window is, so a server treats the download as it treats the page.
private let BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

public struct PDFText: Sendable, Equatable {
    public let title: String
    public let text: String
    public let pages: Int
    /// How many pages the text reaches into, fewer than `pages` when it was cut.
    public let read: Int
}

/// Room kept for the closing line that says where the text stops.
private let NOTE_ROOM = 160

/// The text of a PDF from page `from` on, page by page with each page marked, so a claim drawn
/// from it can be found again, up to `most` characters. Text cut short says so, and says which
/// page to read from to go on.
public func textOf(pdf data: Data, most: Int = PDF_MOST, from: Int = 1) throws -> PDFText {
    guard data.prefix(1024).range(of: Data("%PDF".utf8)) != nil else { throw PDFReadingError.notAPDF }
    guard let document = PDFDocument(data: data) else { throw PDFReadingError.unreadable }

    let budget = max(0, most - NOTE_ROOM)
    let first = min(max(1, from), max(1, document.pageCount))
    var text = ""
    var length = 0
    var read = 0
    var whole = true
    for index in (first - 1)..<document.pageCount where length < budget {
        let words = (document.page(at: index)?.string ?? "")
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        let page = "[page \(index + 1)] \(words)\n"
        let marked = String(page.prefix(budget - length))
        whole = marked.count == page.count
        text += marked
        length += marked.count
        read = index + 1
    }
    if read < document.pageCount || !whole {
        let next = whole ? read + 1 : read
        text += "\n[the text stops here, in a document of \(document.pageCount) pages; read it again from page \(next) to go on]"
    }

    let named = (document.documentAttributes?[PDFDocumentAttribute.titleAttribute] as? String)?
        .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let opening = text.hasPrefix("[page 1] ") ? String(text.dropFirst("[page 1] ".count).prefix(120)) : ""
    return PDFText(
        title: named.isEmpty ? opening.trimmingCharacters(in: .whitespacesAndNewlines) : named,
        text: text,
        pages: document.pageCount,
        read: read
    )
}

/// The host's proxy, and how to prove oneself to it: a password made for one launch of the app.
public struct ProxyAccess: Sendable {
    public let port: UInt16
    public let user: String
    public let password: String

    public init(port: UInt16, user: String, password: String) {
        self.port = port
        self.user = user
        self.password = password
    }
}

/// A session that goes out only through the host's proxy, which looks each name up itself and
/// connects only to a public address it found, so a name cannot answer one way when it is checked
/// here and another when the download connects.
private func session(through access: ProxyAccess) -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    if let at = NWEndpoint.Port(rawValue: access.port) {
        var proxy = ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: at))
        proxy.applyCredential(username: access.user, password: access.password)
        configuration.proxyConfigurations = [proxy]
    }
    return URLSession(configuration: configuration)
}

/// Downloads a PDF and reads it. Done here rather than in the reader window, which can show a
/// PDF but cannot hand back its text.
public func readPDF(at url: URL, from: Int = 1, through proxy: ProxyAccess? = nil) async throws -> PDFText {
    guard url.scheme == "https" || url.scheme == "http", let host = url.host(percentEncoded: false) else {
        throw PDFReadingError.notAnAddress
    }
    if leadsNearby(host: host) { throw PDFReadingError.nearby }
    var asking = URLRequest(url: url, timeoutInterval: PDF_PATIENCE)
    asking.setValue(BROWSER, forHTTPHeaderField: "User-Agent")
    asking.setValue("application/pdf,*/*;q=0.8", forHTTPHeaderField: "Accept")

    let staying = StaysOnPublicWeb()
    let downloading = proxy.map { session(through: $0) } ?? URLSession.shared
    defer { if downloading !== URLSession.shared { downloading.finishTasksAndInvalidate() } }
    let (bytes, response) = try await downloading.bytes(for: asking, delegate: staying)
    if staying.turnedBack { throw PDFReadingError.nearby }
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
        throw PDFReadingError.refused(http.statusCode)
    }
    if response.expectedContentLength > PDF_BIGGEST { throw PDFReadingError.tooLarge }
    var data = Data()
    for try await byte in bytes {
        data.append(byte)
        if data.count > PDF_BIGGEST { throw PDFReadingError.tooLarge }
    }
    return try textOf(pdf: data, from: from)
}
