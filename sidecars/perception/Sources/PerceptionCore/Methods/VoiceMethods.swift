public func voiceHandlers(_ voice: Voice) -> [String: Handler] {
    [
        "voice.say": { params in
            guard case .string(let text)? = params["text"] else {
                throw VoiceError.missingText
            }
            voice.say(text)
            return .object(["speaking": .bool(true)])
        },
        "voice.stop": { _ in
            voice.stop()
            return .object(["speaking": .bool(false)])
        },
    ]
}

public enum VoiceError: Error, CustomStringConvertible {
    case missingText

    public var description: String {
        "voice.say needs a text parameter"
    }
}
