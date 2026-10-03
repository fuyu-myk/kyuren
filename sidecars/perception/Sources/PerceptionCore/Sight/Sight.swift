@preconcurrency import AVFoundation
import Foundation

public enum SightError: Error, CustomStringConvertible {
    case notPermitted(CameraPermission)
    case noCamera
    case noTracker(String)

    public var description: String {
        switch self {
        case .notPermitted(let permission): return "camera access is \(permission.rawValue)"
        case .noCamera: return "there is no camera to look through"
        case .noTracker(let why): return "hands cannot be tracked: \(why)"
        }
    }
}

/// The camera, open only while someone is reaching into the graph. Frames are looked at here and
/// nowhere else: what leaves this process is a point and a word for what each hand is doing.
public final class Sight: NSObject, @unchecked Sendable {
    private let transport: any Transport
    private let following = Following()
    private let hands: Result<Hands, Error>
    private let lock = NSLock()
    private let frames = DispatchQueue(label: "kyuren.sight")
    /// Opening and closing happen in the order they were asked for, on a queue of their own. Two
    /// presses in a moment would otherwise let a camera be told to start after it was told to
    /// stop, and it would stay on with nothing left holding it.
    private let turns = DispatchQueue(label: "kyuren.sight.turns")
    private var session: AVCaptureSession?
    /// Since the camera opened: frames looked at and frames a hand was found in. Counts only, and
    /// only so that a hand going missing can say whether the room was empty or the reading was
    /// failing.
    private var looked = 0
    private var found = 0
    /// Time spent looking, and how often the palm detector had to be asked, so that a slow frame
    /// can be told apart from a lost hand. Both are aggregates of the program, not of the person.
    private var spent = 0.0
    private var searched = 0
    private var complained = false

    public init(transport: any Transport) {
        self.transport = transport
        // Loaded once, up front, so a model that is missing or will not open is known about before
        // anyone asks for the camera rather than at the moment they do.
        self.hands = Result { try Hands() }
        super.init()
    }

    /// Why hands cannot be tracked, if they cannot.
    public var trouble: String? {
        if case .failure(let why) = hands { return String(describing: why) }
        return nil
    }

    public var isOpen: Bool {
        lock.lock()
        defer { lock.unlock() }
        return session != nil
    }

    /// Returns false when a permission prompt was raised instead, in which case the camera opens
    /// later and announces itself with a sight.opened event.
    public func startAllowingPrompt() throws -> Bool {
        switch CameraPermission.current() {
        case .authorized:
            try start()
            return true

        case .undetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                guard let self else { return }
                self.transport.send(.event(
                    name: "camera.permission",
                    data: .object(["status": .string(CameraPermission.current().rawValue)])
                ))
                if granted { try? self.start() }
            }
            return false

        case let refused:
            throw SightError.notPermitted(refused)
        }
    }

    private func start() throws {
        if let trouble { throw SightError.noTracker(trouble) }

        lock.lock()
        defer { lock.unlock() }
        if session != nil { return }

        let made = try assemble()
        session = made
        turns.async { [transport] in
            made.startRunning()
            transport.send(.event(name: "sight.opened", data: nil))
        }
    }

    private func assemble() throws -> AVCaptureSession {
        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
            ?? AVCaptureDevice.default(for: .video)
        guard let device else { throw SightError.noCamera }

        let made = AVCaptureSession()
        made.beginConfiguration()
        made.sessionPreset = .high

        let input = try AVCaptureDeviceInput(device: device)
        guard made.canAddInput(input) else { throw SightError.noCamera }
        made.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.setSampleBufferDelegate(self, queue: frames)
        guard made.canAddOutput(output) else { throw SightError.noCamera }
        made.addOutput(output)
        made.commitConfiguration()
        looked = 0
        found = 0
        spent = 0
        searched = 0
        complained = false
        return made
    }

    /// Everything is taken apart rather than paused, because the light beside the camera is the
    /// user's only proof that it is off and it stays on for a session that is merely idle.
    public func stop() {
        lock.lock()
        let going = session
        session = nil
        if let going {
            turns.async { [weak self, transport] in
                going.stopRunning()
                for input in going.inputs { going.removeInput(input) }
                for output in going.outputs { going.removeOutput(output) }
                // Safe only here: once stopRunning has returned there is no frame still being read.
                self?.forgetHand()
                transport.send(.event(name: "sight.closed", data: nil))
            }
        }
        lock.unlock()

        // Waited for rather than left running, because the process may be about to exit and the
        // light beside the camera has to go out before it does.
        guard going != nil else { return }
        turns.sync {}
    }

    private func forgetHand() {
        following.forget()
        if case .success(let hands) = hands { hands.forget() }
    }

    private func report(_ seen: Seen) {
        switch seen.primary {
        case .hand(let hand):
            transport.send(.event(name: "hand.pose", data: poseOf(hand, other: seen.other)))
        case .lost:
            transport.send(.event(
                name: "hand.lost",
                data: .object([
                    "of": .number(Double(looked)),
                    "found": .number(Double(found)),
                    "searched": .number(Double(searched)),
                    "ms": .number((spent / Double(max(1, looked)) * 10).rounded() / 10),
                ])
            ))
        case .nothing:
            break
        }
    }
}

/// The twenty one joints the model gives, mirrored so that a hand moved to the right moves to the
/// right and put on the frame's zero to one scale, with the seven a gesture is read from named.
func handOf(_ landmarks: [Joint], width: Int, height: Int) -> Hand {
    let skeleton = landmarks.map { facing(x: $0.x / Double(width), y: $0.y / Double(height)) }
    return Hand(
        wrist: skeleton[0],
        knuckle: skeleton[9],
        thumb: skeleton[4],
        index: skeleton[8],
        middle: skeleton[12],
        ring: skeleton[16],
        little: skeleton[20],
        skeleton: skeleton
    )
}

/// Everything a frame is allowed to become. The picture is looked at in this process and is not
/// kept, not written down and not passed on: the joints of a hand, a fraction and a word leave,
/// the same again for the other hand when there is one, and nothing else.
func poseOf(_ seen: Tracked, other: Tracked? = nil) -> JSONValue {
    var pose: [String: JSONValue] = [
        "x": .number(place(seen.at.x)),
        "y": .number(place(seen.at.y)),
        "hand": .array(seen.skeleton.flatMap { [JSONValue.number(place($0.x)), .number(place($0.y))] }),
        "grip": .string(seen.grip.rawValue),
        "pinch": .number(place(seen.pinch)),
    ]
    if let other { pose["other"] = poseOf(other) }
    return .object(pose)
}

private func place(_ value: Double) -> Double {
    (value * 10000).rounded() / 10000
}

extension Sight: AVCaptureVideoDataOutputSampleBufferDelegate {
    public func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard case .success(let hands) = hands else { return }
        guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        looked += 1
        // Timed from arrival to the last byte sent, because a frame that is slow anywhere in here
        // is a frame the camera drops the next of.
        let began = DispatchTime.now()
        defer { spent += Double(DispatchTime.now().uptimeNanoseconds - began.uptimeNanoseconds) / 1e6 }

        CVPixelBufferLockBaseAddress(pixels, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixels, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixels) else { return }
        let picture = Picture(
            width: CVPixelBufferGetWidth(pixels),
            height: CVPixelBufferGetHeight(pixels),
            bytesPerRow: CVPixelBufferGetBytesPerRow(pixels),
            bytes: base.assumingMemoryBound(to: UInt8.self)
        )

        let joints: [[Joint]]
        do {
            joints = try hands.see(picture)
            if hands.searchedLast { searched += 1 }
        } catch {
            // Said once, because a model that will not run looks exactly like an empty room and
            // would otherwise be diagnosed as one for as long as the camera is open.
            if !complained {
                complained = true
                transport.send(.event(
                    name: "sight.trouble",
                    data: .object(["reason": .string(String(describing: error))])
                ))
            }
            return
        }

        let seen = joints.map { handOf($0, width: picture.width, height: picture.height) }
        if !seen.isEmpty { found += 1 }
        report(following.saw(seen))
    }
}
