import Foundation
import os

/// Endings of names that only ever lead to this machine or the network it sits on.
private let NEARBY_ENDINGS = [".localhost", ".local", ".internal", ".lan", ".home.arpa"]

private func nearbyV4(_ name: String) -> Bool {
    let parts = name.split(separator: ".", omittingEmptySubsequences: false).compactMap { Int($0) }
    guard parts.count == 4, name.split(separator: ".", omittingEmptySubsequences: false).count == 4 else { return false }
    let (a, b) = (parts[0], parts[1])
    // Shared address space, where a carrier's or a mesh network's machines sit, is not public either.
    return a == 127 || a == 0 || a == 10 || (a == 169 && b == 254) || (a == 172 && (16...31).contains(b))
        || (a == 192 && b == 168) || (a == 100 && (64...127).contains(b))
}

/// An address written out the one way the system writes it, whichever way it was spelled.
private func written(_ family: Int32, _ address: UnsafeRawPointer) -> String? {
    var name = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
    guard inet_ntop(family, address, &name, socklen_t(name.count)) != nil else { return nil }
    return String(decoding: name.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
}

/// A network this machine is on: an address of its own there, and how many leading bits name it.
typealias Network = (address: [UInt8], prefix: Int)

/// Every network this machine is on, its own public ones included: on a network with public
/// addresses, the router and everything beside it are as near as anything private.
func ownNetworks() -> [Network] {
    var all: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&all) == 0, let first = all else { return [] }
    defer { freeifaddrs(first) }
    var found: [Network] = []
    var at: UnsafeMutablePointer<ifaddrs>? = first
    while let one = at {
        if let address = one.pointee.ifa_addr, let mask = one.pointee.ifa_netmask {
            switch Int32(address.pointee.sa_family) {
            case AF_INET:
                let own = address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { withUnsafeBytes(of: $0.pointee.sin_addr) { Array($0) } }
                let bits = mask.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { withUnsafeBytes(of: $0.pointee.sin_addr) { Array($0) } }
                found.append((own, bits.reduce(0) { $0 + $1.nonzeroBitCount }))
            case AF_INET6:
                let own = address.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { withUnsafeBytes(of: $0.pointee.sin6_addr) { Array($0) } }
                let bits = mask.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { withUnsafeBytes(of: $0.pointee.sin6_addr) { Array($0) } }
                found.append((own, bits.reduce(0) { $0 + $1.nonzeroBitCount }))
            default:
                break
            }
        }
        at = one.pointee.ifa_next
    }
    return found
}

/// Every address this machine answers at, written out as the system writes it.
func ownAddresses() -> Set<String> {
    Set(ownNetworks().compactMap { network in
        network.address.withUnsafeBytes { raw in
            raw.baseAddress.flatMap { written(network.address.count == 4 ? AF_INET : AF_INET6, $0) }
        }
    })
}

/// Whether an address is on a network: the same as the network's own address in its leading bits.
/// A mask wider than any network's, misreported say, would make every address nearby, so it holds
/// only its own address.
func holds(_ network: Network, _ address: [UInt8]) -> Bool {
    guard network.address.count == address.count, !address.isEmpty else { return false }
    if network.address == address { return true }
    let widest = address.count == 4 ? 8 : 32
    guard (widest...(address.count * 8)).contains(network.prefix) else { return false }
    for bit in 0..<network.prefix {
        let (byte, shift) = (bit / 8, 7 - bit % 8)
        if (network.address[byte] >> shift) & 1 != (address[byte] >> shift) & 1 { return false }
    }
    return true
}

private func onNetwork(_ address: [UInt8]) -> Bool {
    ownNetworks().contains { holds($0, address) }
}

private func nearbyV6(_ name: String) -> Bool {
    var address = in6_addr()
    let plain = String(name.split(separator: "%", maxSplits: 1).first ?? "")
    guard inet_pton(AF_INET6, plain, &address) == 1 else { return true }
    let bytes = withUnsafeBytes(of: address) { Array($0) }
    // Unspecified, loopback, and a v4 address written as v6, which could be any of the above.
    let v4Inside = bytes[0..<10].allSatisfy { $0 == 0 }
        && ((bytes[10] == 0 && bytes[11] == 0) || (bytes[10] == 0xff && bytes[11] == 0xff))
    return v4Inside || bytes[0] & 0xfe == 0xfc || (bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80) || onNetwork(bytes)
}

/// Whether a host is this machine or the network it sits on, by name or by address in either
/// family, judged as the core and the host judge one.
public func nearby(host: String) -> Bool {
    var name = host.lowercased()
    if name.hasPrefix("["), name.hasSuffix("]") { name = String(name.dropFirst().dropLast()) }
    if name.hasSuffix(".") { name = String(name.dropLast()) }
    if name.contains(":") { return nearbyV6(name) }
    // A name of one word is found through the network's own search domains, never the public web's.
    if !name.contains(".") || NEARBY_ENDINGS.contains(where: { name.hasSuffix($0) }) { return true }
    var v4 = in_addr()
    let onOwn = inet_pton(AF_INET, name, &v4) == 1 && onNetwork(withUnsafeBytes(of: v4) { Array($0) })
    return nearbyV4(name) || onOwn
}

private func isAddress(_ host: String) -> Bool {
    var v4 = in_addr()
    var v6 = in6_addr()
    let name = host.hasPrefix("[") && host.hasSuffix("]") ? String(host.dropFirst().dropLast()) : host
    return inet_pton(AF_INET, name, &v4) == 1 || inet_pton(AF_INET6, name, &v6) == 1
}

/// Every address the system's resolver finds for a host, written out as numbers.
public func addresses(of host: String) -> [String] {
    var hints = addrinfo()
    hints.ai_family = AF_UNSPEC
    hints.ai_socktype = SOCK_STREAM
    var found: UnsafeMutablePointer<addrinfo>?
    guard getaddrinfo(host, nil, &hints, &found) == 0, let first = found else { return [] }
    defer { freeaddrinfo(first) }
    var written: [String] = []
    var at: UnsafeMutablePointer<addrinfo>? = first
    while let one = at {
        var name = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        if getnameinfo(one.pointee.ai_addr, one.pointee.ai_addrlen, &name, socklen_t(name.count), nil, 0, NI_NUMERICHOST) == 0 {
            written.append(String(decoding: name.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self))
        }
        at = one.pointee.ai_next
    }
    return written
}

/// Whether a host leads to this machine or its network: by its name, or by any address it is found
/// at. A name that cannot be looked up is not trusted to lead anywhere else. A name whose answer
/// changes between this look and the download's own is beyond what a look can tell.
public func leadsNearby(host: String, resolve: (String) -> [String] = addresses(of:)) -> Bool {
    if nearby(host: host) { return true }
    if isAddress(host) { return false }
    let found = resolve(host)
    return found.isEmpty || found.contains(where: { nearby(host: $0) })
}

/// Follows a redirect only to the public web: one that would lead to this machine or its network is
/// stopped where it is, and the download then fails as one that was led there.
final class StaysOnPublicWeb: NSObject, URLSessionTaskDelegate, Sendable {
    private let resolve: @Sendable (String) -> [String]
    private let stopped = OSAllocatedUnfairLock(initialState: false)

    init(resolve: @escaping @Sendable (String) -> [String] = addresses(of:)) {
        self.resolve = resolve
    }

    var turnedBack: Bool { stopped.withLock { $0 } }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        guard let host = request.url?.host(percentEncoded: false), !leadsNearby(host: host, resolve: resolve) else {
            stopped.withLock { $0 = true }
            return nil
        }
        return request
    }
}
