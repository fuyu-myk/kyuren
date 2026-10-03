import Foundation
import OnnxRuntimeBindings

public enum HandsError: Error, CustomStringConvertible {
    case missing(String)
    case unanswered(String)

    public var description: String {
        switch self {
        case .missing(let name): return "the \(name) model is not with the sidecar"
        case .unanswered(let name): return "the model gave no \(name)"
        }
    }
}

/// How sure the landmark model must be that it was shown a hand, both to report one and to be
/// trusted about where to look for it next.
private let PRESENT = 0.5

/// How many hands are followed at once: one to aim with and one to hold with.
public let MOST_HANDS = 2

/// How often a second hand is looked for while one is being followed, in frames. Looking is the
/// expensive path and a second hand is the exception, so it is looked for now and then rather
/// than in every frame the first is in.
private let LOOK_AGAIN = 12

/// The two models, and the memory of where the hands were. Once a hand has been found the palm
/// detector is not run for it again: the last frame's landmarks say where to look, and the hand
/// is followed from frame to frame rather than found afresh in each, which is what keeps the
/// reading from flickering. The detector is asked again when a hand is lost, and now and then
/// while there is room for another.
public final class Hands: @unchecked Sendable {
    private let detector: ORTSession
    private let landmarker: ORTSession
    private let placed = anchors()
    private var following: [Patch] = []
    private var sinceLooked = 0
    /// Whether the last frame needed the palm detector, which is the expensive way to find a hand.
    public private(set) var searchedLast = false

    public init() throws {
        let environment = try ORTEnv(loggingLevel: .warning)
        let options = try ORTSessionOptions()

        func load(_ name: String) throws -> ORTSession {
            let at = Bundle.module.url(forResource: name, withExtension: "onnx", subdirectory: "Models")
            guard let at else { throw HandsError.missing(name) }
            return try ORTSession(env: environment, modelPath: at.path, sessionOptions: options)
        }
        detector = try load("hand_detector")
        landmarker = try load("hand_landmarks_detector")
    }

    public func forget() {
        following = []
        sinceLooked = 0
    }

    /// The twenty one landmarks of each hand in the picture, in pixels, followed hands first, or
    /// nothing. A hand that was being followed and is not where it was is looked for again in the
    /// same frame, so losing it costs a moment's more work rather than a frame's silence; a second
    /// hand is looked for now and then.
    public func see(_ picture: Picture) throws -> [[Joint]] {
        searchedLast = false
        var found: [(joints: [Joint], patch: Patch)] = []
        for patch in following {
            if let joints = try landmarks(in: patch, of: picture) {
                found.append((joints, patchAround(landmarks: joints)))
            }
        }

        sinceLooked += 1
        let room = found.count < MOST_HANDS
        let lostOne = found.count < following.count
        if room, found.isEmpty || lostOne || sinceLooked >= LOOK_AGAIN {
            searchedLast = true
            sinceLooked = 0
            let whole = wholeOf(width: picture.width, height: picture.height)
            for palm in try detect(in: picture, most: MOST_HANDS) {
                guard found.count < MOST_HANDS else { break }
                let patch = patchAround(palm, in: whole)
                // A palm where a hand is already being followed is that hand, seen twice.
                if found.contains(where: { sameHand($0.patch, patch) }) { continue }
                if let joints = try landmarks(in: patch, of: picture) {
                    found.append((joints, patchAround(landmarks: joints)))
                }
            }
        }

        following = found.map(\.patch)
        return found.map(\.joints)
    }

    private func detect(in picture: Picture, most: Int) throws -> [Palm] {
        let whole = wholeOf(width: picture.width, height: picture.height)
        let answered = try run(detector, tensorOf(picture, whole, side: DETECTOR_SIDE), side: DETECTOR_SIDE)
        guard let boxes = answered["Identity"] else { throw HandsError.unanswered("boxes") }
        guard let scores = answered["Identity_1"] else { throw HandsError.unanswered("scores") }
        return palmsIn(boxes: boxes, scores: scores, anchors: placed, most: most)
    }

    func landmarks(in patch: Patch, of picture: Picture) throws -> [Joint]? {
        let answered = try run(landmarker, tensorOf(picture, patch, side: LANDMARK_SIDE), side: LANDMARK_SIDE)
        guard let raw = answered["Identity"] else { throw HandsError.unanswered("landmarks") }
        guard let presence = answered["Identity_1"]?.first else { throw HandsError.unanswered("presence") }
        guard let read = landmarksFrom(raw, presence: presence), read.presence >= PRESENT else {
            return nil
        }
        return read.points.map { project($0, from: patch) }
    }

    private func run(_ session: ORTSession, _ tensor: [Float], side: Int) throws -> [String: [Float]] {
        let data = tensor.withUnsafeBufferPointer {
            NSMutableData(bytes: $0.baseAddress, length: $0.count * MemoryLayout<Float>.size)
        }
        let input = try ORTValue(
            tensorData: data,
            elementType: .float,
            shape: [1, NSNumber(value: side), NSNumber(value: side), 3]
        )
        let outputs = try session.run(
            withInputs: ["input_1": input],
            outputNames: ["Identity", "Identity_1"],
            runOptions: nil
        )
        var read: [String: [Float]] = [:]
        for (name, value) in outputs {
            let bytes = try value.tensorData() as Data
            read[name] = bytes.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
        }
        return read
    }
}


/// Whether two patches are on the same hand: their middles closer than half a patch.
func sameHand(_ one: Patch, _ other: Patch) -> Bool {
    hypot(one.x - other.x, one.y - other.y) < max(one.side, other.side) / 2
}
