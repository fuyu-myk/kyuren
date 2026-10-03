import Foundation

/// Kokoro hands back raw samples, and `AVAudioPlayer` wants a container, so one is written here.
public func wav(from samples: [Float], sampleRate: Double) -> Data {
    var data = Data(capacity: samples.count * 2 + 44)

    func ascii(_ text: String) { data.append(text.data(using: .ascii)!) }
    func u32(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
    func u16(_ value: UInt16) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }

    let payload = UInt32(samples.count * 2)
    let rate = UInt32(sampleRate)

    ascii("RIFF"); u32(36 + payload); ascii("WAVE")
    ascii("fmt "); u32(16); u16(1); u16(1)
    u32(rate); u32(rate * 2); u16(2); u16(16)
    ascii("data"); u32(payload)

    var pcm = [Int16](repeating: 0, count: samples.count)
    for index in samples.indices {
        pcm[index] = Int16(max(-1, min(1, samples[index])) * 32767)
    }
    pcm.withUnsafeBufferPointer { buffer in
        data.append(UnsafeRawBufferPointer(buffer).bindMemory(to: UInt8.self))
    }
    return data
}
