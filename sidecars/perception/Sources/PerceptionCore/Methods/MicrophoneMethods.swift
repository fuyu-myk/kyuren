public func microphoneHandlers(
    _ microphone: Microphone,
    _ speech: SpeechStream,
    _ voice: Voice,
    _ transport: any Transport
) -> [String: Handler] {
    [
        "microphone.permission": { _ in
            .object(["status": .string(MicrophonePermission.current().rawValue)])
        },
        "microphone.request": { _ in
            requestMicrophone(transport)
            return .object(["status": .string(MicrophonePermission.current().rawValue)])
        },
        "microphone.start": { _ in
            speech.start()
            voice.warm()
            let running = try microphone.startAllowingPrompt(for: .orb)
            return .object([
                "running": .bool(running),
                "status": .string(running ? "capturing" : "awaiting permission"),
            ])
        },
        "microphone.stop": { _ in
            // Dismissing is the way out of a turn that has gone wrong, so it clears everything:
            // any speech in flight, the queued audio behind it, and the ducking that came with it.
            microphone.stop(for: .orb)
            speech.stop()
            voice.stop()
            return .object(["running": .bool(false)])
        },
    ]
}
