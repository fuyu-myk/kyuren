import Foundation
import Testing

@testable import PerceptionCore

@Suite("Nearby addresses")
struct NearbyTests {
    private static let looked: @Sendable (String) -> [String] = { host in
        [
            "home.example": ["127.0.0.1"],
            "away.example": ["93.184.216.34", "2606:2800:220:1::"],
            "split.example": ["93.184.216.34", "10.0.0.5"],
        ][host] ?? []
    }

    @Test("this machine and its network are nearby, by name or by address in either family")
    func nearbyHosts() {
        for host in [
            "localhost", "localhost.", "router", "app.localhost", "printer.local", "router.lan",
            "nas.home.arpa", "metadata.google.internal", "127.0.0.1", "0.0.0.0", "10.1.2.3",
            "172.16.4.4", "192.168.0.5", "169.254.169.254", "100.100.100.100", "[::1]", "::",
            "::ffff:7f00:1", "fd12:3456::1", "fe80::1%en0",
        ] {
            #expect(nearby(host: host), "\(host)")
        }
    }

    @Test("the public web is not nearby, whatever its names start with")
    func publicHosts() {
        for host in ["example.com", "fdic.gov", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "localhost.example.com"] {
            #expect(!nearby(host: host), "\(host)")
        }
    }

    @Test("a public name that leads home is nearby, and one that cannot be looked up is not trusted")
    func lookedUp() {
        #expect(leadsNearby(host: "home.example", resolve: Self.looked))
        #expect(!leadsNearby(host: "away.example", resolve: Self.looked))
        #expect(leadsNearby(host: "split.example", resolve: Self.looked), "one address at home is enough")
        #expect(leadsNearby(host: "nowhere.example", resolve: Self.looked))
        #expect(!leadsNearby(host: "93.184.216.34", resolve: Self.looked), "an address is not looked up")
        #expect(leadsNearby(host: "2130706433"), "a number the resolver reads as this machine")
    }

    @Test("a download is not followed to this machine or its network, and is to the public web")
    func redirects() async throws {
        let from = try #require(URL(string: "https://example.com/paper.pdf"))
        let task = URLSession.shared.dataTask(with: from)
        let moved = try #require(HTTPURLResponse(url: from, statusCode: 302, httpVersion: nil, headerFields: nil))

        let home = StaysOnPublicWeb(resolve: Self.looked)
        let led = try #require(URL(string: "https://home.example/paper.pdf"))
        let followed = await home.urlSession(URLSession.shared, task: task, willPerformHTTPRedirection: moved, newRequest: URLRequest(url: led))
        #expect(followed == nil)
        #expect(home.turnedBack)

        let away = StaysOnPublicWeb(resolve: Self.looked)
        let onward = try #require(URL(string: "https://away.example/paper.pdf"))
        #expect(await away.urlSession(URLSession.shared, task: task, willPerformHTTPRedirection: moved, newRequest: URLRequest(url: onward)) != nil)
        #expect(!away.turnedBack)
    }

    @Test("a PDF on this machine or its network is never asked for")
    func refusedAtOnce() async throws {
        let home = try #require(URL(string: "http://127.0.0.1:9/paper.pdf"))
        await #expect(throws: PDFReadingError.nearby) { try await readPDF(at: home) }
    }
}

extension NearbyTests {
    @Test("an IPv6 address is nearby however it is spelled, and so is every address this machine answers at")
    func spellings() {
        for host in ["0:0:0:0:0:0:0:1", "0000::1", "0::1", "0:0:0:0:0:ffff:7f00:1", "[0:0:0:0:0:0:0:1]", "fe80::1%en0"] {
            #expect(nearby(host: host), "\(host)")
        }
        let own = ownAddresses()
        #expect(!own.isEmpty)
        for address in own {
            #expect(nearby(host: address), "\(address)")
        }
    }
}

/// A proxy that says what it was asked to connect to, once, and refuses it.
private final class RefusingProxy: @unchecked Sendable {
    let port: UInt16
    private let listening: Int32
    private let lock = NSLock()
    private var heard: String?

    init() throws {
        let opened = socket(AF_INET, SOCK_STREAM, 0)
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(opened, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        guard bound == 0, listen(opened, 1) == 0 else {
            close(opened)
            throw PDFReadingError.unreadable
        }
        var size = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(opened, $0, &size) } }
        listening = opened
        port = UInt16(bigEndian: address.sin_port)
        Thread.detachNewThread { [self] in
            let client = accept(listening, nil, nil)
            var read = [UInt8](repeating: 0, count: 2048)
            let got = recv(client, &read, read.count, 0)
            let line = String(decoding: read.prefix(max(0, got)), as: UTF8.self).split(separator: "\r\n").first.map(String.init)
            lock.withLock { heard = line }
            let refusal = Array("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n".utf8)
            _ = send(client, refusal, refusal.count, 0)
            close(client)
        }
    }

    var asked: String? { lock.withLock { heard } }

    deinit { close(listening) }
}

extension NearbyTests {
    @Test("a download goes out through the host's proxy, which is asked for the address by name")
    func throughTheProxy() async throws {
        let proxy = try RefusingProxy()
        let paper = try #require(URL(string: "https://93.184.216.34/paper.pdf"))
        await #expect(throws: (any Error).self) { try await readPDF(at: paper, through: ProxyAccess(port: proxy.port, user: "kyuren", password: "secret")) }
        #expect(proxy.asked == "CONNECT 93.184.216.34:443 HTTP/1.1")
    }
}

extension NearbyTests {
    private func bytes(_ address: String) -> [UInt8] {
        var v4 = in_addr()
        var v6 = in6_addr()
        if inet_pton(AF_INET, address, &v4) == 1 { return withUnsafeBytes(of: v4) { Array($0) } }
        if inet_pton(AF_INET6, address, &v6) == 1 { return withUnsafeBytes(of: v6) { Array($0) } }
        return []
    }

    @Test("an address on a network this machine is on is nearby, however public its range")
    func onLink() {
        let home = (address: bytes("2001:db8:1234:5678::abcd"), prefix: 64)
        #expect(holds(home, bytes("2001:db8:1234:5678::1")), "the router")
        #expect(!holds(home, bytes("2001:db8:1234:5679::1")), "the next network over")
        let office = (address: bytes("203.0.113.40"), prefix: 24)
        #expect(holds(office, bytes("203.0.113.1")))
        #expect(!holds(office, bytes("203.0.114.1")))
        #expect(!holds((address: bytes("2001:db8::1"), prefix: 0), bytes("2606:4700::1111")), "a mask too wide to be a network is no network")
        #expect(!holds(home, bytes("203.0.113.1")), "nor does one family hold the other's addresses")
    }
}

extension NearbyTests {
    @Test("a download given no proxy to go through is refused rather than made straight")
    func unproxied() async throws {
        let read = try #require(readingHandlers()["pdf.read"])
        await #expect(throws: PDFReadingError.unproxied) { _ = try await read(["url": .string("https://93.184.216.34/paper.pdf")]) }
    }
}
