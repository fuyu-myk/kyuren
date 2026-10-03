public func wakeHandlers(_ ear: Ear, _ microphone: Microphone) -> [String: Handler] {
    [
        "wake.start": { params in
            var threshold = THRESHOLD
            if case .number(let given)? = params["threshold"] { threshold = given }
            // The ear is opened before the microphone, so the first thing said is not missed.
            try ear.start(threshold: threshold)
            let open = try microphone.startAllowingPrompt(for: .ear)
            return .object([
                "listening": .bool(true),
                "microphone": .string(open ? "open" : "awaiting permission"),
                "threshold": .number(threshold),
            ])
        },
        "wake.stop": { _ in
            ear.stop()
            microphone.stop(for: .ear)
            return .object(["listening": .bool(false)])
        },
        "wake.state": { _ in
            .object([
                "listening": .bool(ear.isListening),
                "tracker": .string(ear.trouble ?? "ready"),
                "microphone": .bool(microphone.isRunning),
            ])
        },
    ]
}
