import CoreImage
import Foundation
import ScreenCaptureKit

public enum CaptureError: Error, CustomStringConvertible {
    case noDisplay
    case cannotWrite

    public var description: String {
        switch self {
        case .noDisplay: return "there is no display to capture"
        case .cannotWrite: return "the capture could not be written"
        }
    }
}

public struct Capture: Sendable {
    public let path: String
    public let width: Int
    public let height: Int
}

/// One frame of what is on screen, written to a file on this machine and sent nowhere. There is
/// no stream and no watcher: the permission behind this prompts again and again, so anything
/// continuous would nag forever.
public func captureScreen(into folder: URL) async throws -> Capture {
    let content = try await SCShareableContent.excludingDesktopWindows(
        false,
        onScreenWindowsOnly: true
    )
    guard let display = content.displays.first else { throw CaptureError.noDisplay }

    let shape = SCStreamConfiguration()
    shape.width = display.width
    shape.height = display.height

    let frame = try await SCScreenshotManager.captureImage(
        contentFilter: SCContentFilter(display: display, excludingWindows: []),
        configuration: shape
    )

    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let at = folder.appendingPathComponent("\(Int(Date().timeIntervalSince1970 * 1000)).png")
    let space = frame.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB)
    guard let space else { throw CaptureError.cannotWrite }

    try CIContext().writePNGRepresentation(
        of: CIImage(cgImage: frame),
        to: at,
        format: .RGBA8,
        colorSpace: space
    )
    return Capture(path: at.path, width: frame.width, height: frame.height)
}

private final class Held<T>: @unchecked Sendable {
    var value: Result<T, Error>?
}

/// Requests are answered one at a time on the reading thread, and a capture is the one piece of
/// work here that is written as async. Waiting for it holds up the next request, which for a
/// single frame is the honest behaviour.
func settled<T: Sendable>(_ work: @escaping @Sendable () async throws -> T) throws -> T {
    let gate = DispatchSemaphore(value: 0)
    let held = Held<T>()
    Task {
        do {
            held.value = .success(try await work())
        } catch {
            held.value = .failure(error)
        }
        gate.signal()
    }
    gate.wait()
    guard let answer = held.value else { throw CaptureError.cannotWrite }
    return try answer.get()
}

public func capturesFolder() -> URL {
    let home = ProcessInfo.processInfo.environment["KYUREN_HOME"]
        ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".kyuren").path
    return URL(fileURLWithPath: home).appendingPathComponent("captures")
}
