import Foundation
import PerceptionCore

let transport = StdioTransport()
let station = Station()

let voice = Voice(station: station, transport: transport)

let speech = SpeechStream(
    transport: transport,
    onBargeIn: {
        guard voice.isSpeaking else { return false }
        voice.stop()
        return true
    },
    recentlySaid: { voice.lastSpoken },
    speaking: { voice.isSpeaking }
)

let sight = Sight(transport: transport)
let ear = Ear(transport: transport)

let microphone = Microphone(station: station, transport: transport) { samples, rate in
    speech.receive(samples, sourceRate: rate)
    ear.receive(samples, sourceRate: rate)
}

voice.whenSpeakingChanges { speaking in
    microphone.setSpeaking(speaking)
    if !Ducking.others(quietened: speaking), speaking {
        transport.send(.event(name: "ducking.unavailable", data: nil))
    }
}

var dispatcher = Dispatcher(transport: transport)
dispatcher.register("ping", ping)
for (method, handler) in microphoneHandlers(microphone, speech, voice, transport) {
    dispatcher.register(method, handler)
}
for (method, handler) in voiceHandlers(voice) {
    dispatcher.register(method, handler)
}
for (method, handler) in sightHandlers(sight, transport) {
    dispatcher.register(method, handler)
}
for (method, handler) in wakeHandlers(ear, microphone) {
    dispatcher.register(method, handler)
}
for (method, handler) in readingHandlers() {
    dispatcher.registerLater(method, handler)
}

transport.send(.event(name: "sidecar.ready", data: .object(["name": .string("perception")])))

// Requests are read on their own thread so the main thread can run a run loop. AVAudioPlayer
// delivers its completion callbacks there, and without one a clip plays but never reports finishing.
let reader = Thread {
    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty {
            dispatcher.handle(trimmed)
        }
    }

    ear.stop()
    microphone.shutdown()
    sight.stop()
    speech.stop()
    voice.shutdown()
    station.shutdown()
    exit(0)
}
reader.stackSize = 1 << 20
reader.start()

RunLoop.main.run()
