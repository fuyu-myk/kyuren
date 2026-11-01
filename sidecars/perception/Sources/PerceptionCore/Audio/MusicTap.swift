import CoreAudio
import Foundation

public enum MusicTapError: Error, CustomStringConvertible {
    case notPlaying
    case unreadable(String)
    case failed(String, OSStatus)

    public var description: String {
        switch self {
        case .notPlaying: return "the player is not sending out any sound yet"
        case .unreadable(let why): return "the music cannot be heard: \(why)"
        case .failed(let step, let status): return "the music cannot be heard: \(step) failed (\(status))"
        }
    }
}

/// The sound of one music player alone, tapped from Core Audio and measured as bands for the
/// island. Only that player's processes are tapped, its sound goes on to the speakers untouched,
/// and nothing is kept: each window is measured and let go. macOS asks before any of it is heard.
public final class MusicTap: @unchecked Sendable {
    /// About as often as the island draws, and no more.
    static let perSecond = 30.0
    /// A player just told to play may not have opened its sound yet, so it is looked for again
    /// this often, this many times, before that is told.
    static let retryEvery = 0.5
    static let retries = 10

    private struct Running {
        let tap: AudioObjectID
        let device: AudioObjectID
        let proc: AudioDeviceIOProcID
    }

    private let transport: any Transport
    /// Making and taking down the tap and its device can take a while, and requests are read one
    /// at a time, so that is done here, in the order asked, and what goes wrong is told after.
    private let control = DispatchQueue(label: "kyuren.music-control")
    private let queue = DispatchQueue(label: "kyuren.music-tap")
    private let bands = Bands()
    private var running: Running?
    /// Counts each listen and quiet, so a retry for a listen since overtaken is let go.
    private var asked = 0
    /// The player last asked to be heard, made again on the new output when the music moves.
    private var wanted: String?
    private var recent = [Float](repeating: 0, count: Bands.size)
    private var since = 0

    public init(transport: any Transport) {
        self.transport = transport
        var property = address(kAudioHardwarePropertyDefaultOutputDevice)
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &property, control) { [weak self] _, _ in
            self?.outputMoved()
        }
    }

    /// Hears the player whose bundle is given, its helpers included, in place of any heard before.
    public func listen(bundle: String) {
        control.async { [self] in
            asked += 1
            wanted = bundle
            attempt(bundle: bundle, asked: asked, left: Self.retries)
        }
    }

    public func quiet() {
        control.async { [self] in
            asked += 1
            wanted = nil
            stop()
        }
    }

    /// The tap is read by the output's clock, so headphones coming or going would leave it silent.
    private func outputMoved() {
        guard running != nil, let bundle = wanted else { return }
        asked += 1
        attempt(bundle: bundle, asked: asked, left: Self.retries)
    }

    private func attempt(bundle: String, asked: Int, left: Int) {
        guard asked == self.asked else { return }
        do {
            try start(bundle: bundle)
        } catch MusicTapError.notPlaying where left > 0 {
            control.asyncAfter(deadline: .now() + Self.retryEvery) { [self] in
                attempt(bundle: bundle, asked: asked, left: left - 1)
            }
        } catch {
            transport.send(.event(name: "music.trouble", data: .object(["reason": .string(String(describing: error))])))
        }
    }

    /// Takes the tap down before returning, for a sidecar on its way out.
    public func shutdown() {
        control.sync {
            asked += 1
            wanted = nil
            stop()
        }
    }

    private func start(bundle: String) throws {
        guard #available(macOS 14.2, *) else { throw MusicTapError.unreadable("hearing one app alone needs macOS 14.2") }
        stop()
        let processes = processObjects(of: bundle)
        guard !processes.isEmpty else { throw MusicTapError.notPlaying }

        let description = CATapDescription(stereoMixdownOfProcesses: processes)
        description.uuid = UUID()
        description.muteBehavior = .unmuted
        description.isPrivate = true
        description.name = "Kyuren music"
        var tap = AudioObjectID(kAudioObjectUnknown)
        try check(AudioHardwareCreateProcessTap(description, &tap), "making the tap")

        do {
            let format = try tapFormat(tap)
            guard format.mFormatID == kAudioFormatLinearPCM, format.mFormatFlags & kAudioFormatFlagIsFloat != 0, format.mBitsPerChannel == 32 else {
                throw MusicTapError.unreadable("the tap does not give 32 bit float samples")
            }
            var aggregate: [String: Any] = [
                kAudioAggregateDeviceNameKey: "Kyuren music",
                kAudioAggregateDeviceUIDKey: UUID().uuidString,
                kAudioAggregateDeviceIsPrivateKey: true,
                kAudioAggregateDeviceIsStackedKey: false,
                kAudioAggregateDeviceTapAutoStartKey: true,
                kAudioAggregateDeviceTapListKey: [[kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: description.uuid.uuidString]],
            ]
            // The output lends the tap its clock, but an output that is also a microphone, as a
            // headset can be, would be heard with it, so such a one is left out and the tap runs alone.
            let output = try defaultOutput()
            if inputStreams(of: output) == 0, let uid = stringProperty(output, kAudioDevicePropertyDeviceUID) {
                aggregate[kAudioAggregateDeviceMainSubDeviceKey] = uid
                aggregate[kAudioAggregateDeviceSubDeviceListKey] = [[kAudioSubDeviceUIDKey: uid]]
            }
            var device = AudioObjectID(kAudioObjectUnknown)
            try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &device), "making the device")

            queue.sync {
                recent = [Float](repeating: 0, count: Bands.size)
                since = 0
            }
            var proc: AudioDeviceIOProcID?
            let rate = nominalRate(of: device) ?? format.mSampleRate
            let created = AudioDeviceCreateIOProcIDWithBlock(&proc, device, queue) { [weak self] _, input, _, _, _ in
                self?.receive(input, rate: rate)
            }
            guard created == noErr, let proc else {
                AudioHardwareDestroyAggregateDevice(device)
                throw MusicTapError.failed("listening to the device", created)
            }
            let started = AudioDeviceStart(device, proc)
            guard started == noErr else {
                AudioDeviceDestroyIOProcID(device, proc)
                AudioHardwareDestroyAggregateDevice(device)
                throw MusicTapError.failed("starting the device", started)
            }
            running = Running(tap: tap, device: device, proc: proc)
        } catch {
            AudioHardwareDestroyProcessTap(tap)
            throw error
        }
    }

    private func stop() {
        guard let was = running else { return }
        running = nil
        AudioDeviceStop(was.device, was.proc)
        AudioDeviceDestroyIOProcID(was.device, was.proc)
        AudioHardwareDestroyAggregateDevice(was.device)
        if #available(macOS 14.2, *) { AudioHardwareDestroyProcessTap(was.tap) }
    }

    /// Runs on the tap's own queue: the channels are mixed to one, and the bands of the latest
    /// window are sent once enough has come in since the last.
    private func receive(_ input: UnsafePointer<AudioBufferList>, rate: Double) {
        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
        guard let first = buffers.first, first.mNumberChannels > 0 else { return }
        let frames = Int(first.mDataByteSize) / (MemoryLayout<Float>.size * Int(first.mNumberChannels))
        guard frames > 0 else { return }

        var mixed = [Float](repeating: 0, count: frames)
        var channels = 0
        for buffer in buffers {
            guard let data = buffer.mData?.assumingMemoryBound(to: Float.self) else { continue }
            let width = Int(buffer.mNumberChannels)
            guard Int(buffer.mDataByteSize) / MemoryLayout<Float>.size >= frames * width else { continue }
            for frame in 0..<frames {
                for channel in 0..<width {
                    mixed[frame] += data[frame * width + channel]
                }
            }
            channels += width
        }
        guard channels > 0 else { return }
        if channels > 1 {
            let share = 1 / Float(channels)
            mixed = mixed.map { $0 * share }
        }

        recent.append(contentsOf: mixed)
        recent.removeFirst(max(0, recent.count - Bands.size))
        since += frames
        guard Double(since) >= rate / Self.perSecond else { return }
        since = 0
        let heard = bands.measure(recent, rate: rate)
        transport.send(.event(name: "music.bands", data: .object([
            "bands": .array(heard.levels.map { .number((Double($0) * 100).rounded() / 100) }),
            "silent": .bool(heard.silent),
        ])))
    }
}

private func check(_ status: OSStatus, _ step: String) throws {
    guard status == noErr else { throw MusicTapError.failed(step, status) }
}

private func address(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
}

private func stringProperty(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var property = address(selector)
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    var value: Unmanaged<CFString>?
    let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &property, 0, nil, &size, $0) }
    guard status == noErr, let value else { return nil }
    return value.takeRetainedValue() as String
}

/// Every process using Core Audio whose bundle is the one given or one of its helpers.
private func processObjects(of bundle: String) -> [AudioObjectID] {
    let system = AudioObjectID(kAudioObjectSystemObject)
    var property = address(kAudioHardwarePropertyProcessObjectList)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(system, &property, 0, nil, &size) == noErr, size > 0 else { return [] }
    var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(system, &property, 0, nil, &size, &objects) == noErr else { return [] }
    return objects.filter { object in
        guard let found = stringProperty(object, kAudioProcessPropertyBundleID) else { return false }
        return found == bundle || found.hasPrefix(bundle + ".")
    }
}

@available(macOS 14.2, *)
private func tapFormat(_ tap: AudioObjectID) throws -> AudioStreamBasicDescription {
    var property = address(kAudioTapPropertyFormat)
    var format = AudioStreamBasicDescription()
    var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
    try check(AudioObjectGetPropertyData(tap, &property, 0, nil, &size, &format), "reading the tap's format")
    return format
}

/// The device the music goes out through.
private func defaultOutput() throws -> AudioObjectID {
    var property = address(kAudioHardwarePropertyDefaultOutputDevice)
    var device = AudioObjectID(kAudioObjectUnknown)
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    try check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &property, 0, nil, &size, &device), "finding the output")
    return device
}

private func inputStreams(of device: AudioObjectID) -> Int {
    var property = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioObjectPropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    // Unreadable, it is taken to have inputs, so it is left out rather than risk hearing one.
    guard AudioObjectGetPropertyDataSize(device, &property, 0, nil, &size) == noErr else { return 1 }
    return Int(size) / MemoryLayout<AudioStreamID>.size
}

/// The rate the device runs at, which the tap is brought to on its way in.
private func nominalRate(of device: AudioObjectID) -> Double? {
    var property = address(kAudioDevicePropertyNominalSampleRate)
    var rate = Float64(0)
    var size = UInt32(MemoryLayout<Float64>.size)
    guard AudioObjectGetPropertyData(device, &property, 0, nil, &size, &rate) == noErr, rate > 0 else { return nil }
    return rate
}
