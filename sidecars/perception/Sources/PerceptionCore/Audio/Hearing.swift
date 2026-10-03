import Foundation
import OnnxRuntimeBindings

public enum HearingError: Error, CustomStringConvertible {
    case missing(String)
    case unanswered(String)

    public var description: String {
        switch self {
        case .missing(let name): return "the \(name) model is not with the sidecar"
        case .unanswered(let name): return "the model gave no \(name)"
        }
    }
}

/// The chain a wake word is heard through, and the contract with the training side: 16 kHz audio
/// on the scale of 16 bit integers, in 80 ms chunks of 1280 samples, becomes one frame of 32 mel
/// bands every 10 ms, which becomes one 96 value embedding per chunk from a 76 frame window taken
/// every 8 frames. A wake word is judged on the last sixteen embeddings, about 1.3 seconds.
/// Training computes exactly this in Python over the same two files; a test holds the two to each
/// other.
public let HEARD_RATE = 16_000
public let CHUNK = 1280
public let MEL_BANDS = 32
public let MEL_WINDOW = 76
public let MEL_STEP = 8
public let EMBEDDING = 96
public let FRAMES = 16

/// Mel frames to keep: enough for a window and the stride's worth of slack, plus a margin so a
/// late chunk does not starve the next window.
private let MEL_KEPT = MEL_WINDOW + MEL_STEP * 4
/// Samples of the previous chunk heard again in front of each new one. A mel frame spans more than
/// one hop, so a chunk on its own gives fewer frames than its length says and each with a ragged
/// edge. With three hops of the last chunk in front, every chunk gives exactly eight frames, and
/// they are the very frames a whole clip gives when heard in one go, which is how training hears
/// it. The first three frames of the first chunk are made of silence and are dropped.
private let TAIL = 480
private let PADDED = 3

public final class Hearing: @unchecked Sendable {
    private let mel: ORTSession
    private let embed: ORTSession
    /// The wake word itself, trained in house. Absent until one has been trained and shipped.
    private let head: ORTSession?
    private var frames: [[Float]] = []
    private var embeddings: [[Float]] = []
    /// Frames already consumed into embeddings, so each new embedding steps eight on from the last.
    private var consumed = 0
    private var tail = [Float](repeating: 0, count: TAIL)
    private var primed = false

    public init() throws {
        let environment = try ORTEnv(loggingLevel: .warning)
        let options = try ORTSessionOptions()
        try options.setIntraOpNumThreads(1)

        func load(_ name: String) throws -> ORTSession {
            let at = Bundle.module.url(forResource: name, withExtension: "onnx", subdirectory: "Hearing")
            guard let at else { throw HearingError.missing(name) }
            return try ORTSession(env: environment, modelPath: at.path, sessionOptions: options)
        }
        mel = try load("melspectrogram")
        embed = try load("embedding_model")
        head = try? load("hey_kyuren")
    }

    /// Whether there is a wake word to hear at all.
    public var trained: Bool {
        head != nil
    }

    /// How sure the wake word is that the last sixteen embeddings hold the phrase, zero to one.
    public func judge(_ recent: [[Float]]) throws -> Double {
        guard let head else { throw HearingError.missing("hey_kyuren") }
        let flat = recent.flatMap { $0 }
        let score = try run(
            head,
            flat,
            shape: [1, NSNumber(value: FRAMES), NSNumber(value: EMBEDDING)],
            wanting: "probability"
        )
        return Double(score.first ?? 0)
    }

    /// The last sixteen embeddings, oldest first, once there are sixteen.
    public var recent: [[Float]]? {
        embeddings.count >= FRAMES ? Array(embeddings.suffix(FRAMES)) : nil
    }

    /// Every embedding still held, oldest first.
    public var heard: [[Float]] {
        embeddings
    }

    public func forget() {
        frames = []
        embeddings = []
        consumed = 0
        tail = [Float](repeating: 0, count: TAIL)
        primed = false
    }

    /// Hears one chunk. Chunks are 1280 samples of 16 kHz audio on the 16 bit integer scale.
    public func hear(_ chunk: [Float]) throws {
        var fresh = try mels(of: tail + chunk)
        if !primed {
            fresh.removeFirst(min(PADDED, fresh.count))
            primed = true
        }
        tail = Array(chunk.suffix(TAIL))
        frames.append(contentsOf: fresh)

        while frames.count - consumed >= MEL_WINDOW {
            let window = Array(frames[consumed..<(consumed + MEL_WINDOW)])
            embeddings.append(try embedding(of: window))
            consumed += MEL_STEP
        }

        // Frames that no window will ever start on are let go of.
        if consumed > MEL_KEPT {
            frames.removeFirst(consumed - MEL_KEPT)
            consumed = MEL_KEPT
        }
        if embeddings.count > FRAMES * 2 {
            embeddings.removeFirst(embeddings.count - FRAMES * 2)
        }
    }

    private func mels(of chunk: [Float]) throws -> [[Float]] {
        let raw = try run(mel, chunk, shape: [1, NSNumber(value: chunk.count)], wanting: "output")
        // Divided by ten and shifted by two, which is the scale the embedding model was trained on.
        let scaled = raw.map { $0 / 10 + 2 }
        return stride(from: 0, to: scaled.count - MEL_BANDS + 1, by: MEL_BANDS).map {
            Array(scaled[$0..<($0 + MEL_BANDS)])
        }
    }

    private func embedding(of window: [[Float]]) throws -> [Float] {
        let flat = window.flatMap { $0 }
        return try run(
            embed,
            flat,
            shape: [1, NSNumber(value: MEL_WINDOW), NSNumber(value: MEL_BANDS), 1],
            wanting: "conv2d_19"
        )
    }

    private func run(_ session: ORTSession, _ tensor: [Float], shape: [NSNumber], wanting: String) throws -> [Float] {
        let data = tensor.withUnsafeBufferPointer {
            NSMutableData(bytes: $0.baseAddress, length: $0.count * MemoryLayout<Float>.size)
        }
        let name = try session.inputNames().first ?? "input"
        let input = try ORTValue(tensorData: data, elementType: .float, shape: shape)
        let outputs = try session.run(withInputs: [name: input], outputNames: [wanting], runOptions: nil)
        guard let value = outputs[wanting] else { throw HearingError.unanswered(wanting) }
        let bytes = try value.tensorData() as Data
        return bytes.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }
}
