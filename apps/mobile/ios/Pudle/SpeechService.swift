import AVFoundation
import PudleCore
import Speech

/// Speaks fixed alert phrases, optionally in a Gemini voice persona, and listens briefly for the
/// driver's yes/no answer. The audio session is active only while speaking or listening: no silent
/// audio and no keep-alive. Background playback relies on the `audio` background mode, used the
/// way navigation apps use it for spoken prompts; it does not keep Pudle running by itself.
@MainActor
final class SpeechService: NSObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate {
    enum Outcome {
        case started(Date, voice: String)
        case finished(Date)
        case failed(String)
    }

    /// Fetches cloud audio for a phrase; nil disables cloud voices.
    var cloudVoice: ((String, Persona) async throws -> Data)?
    var persona: Persona = .copilot
    var useCloudVoice = true
    /// Longest Pudle waits for a cloud voice before falling back to the on-device voice.
    var cloudTimeout: TimeInterval = 2.5

    private let synthesizer = AVSpeechSynthesizer()
    private var player: AVAudioPlayer?
    private var playerCompletion: ((Outcome) -> Void)?
    private var callbacks: [ObjectIdentifier: (Outcome) -> Void] = [:]
    private var generation = 0
    private(set) var lastInterruption: String?
    var onInterruptionChange: ((String?) -> Void)?

    // Listening
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var listenTimer: Task<Void, Never>?
    private var listenCompletion: ((VoiceIntent, String) -> Void)?
    private var lastTranscript = ""
    private var tapInstalled = false

    override init() {
        super.init()
        synthesizer.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(handleInterruption(_:)),
                                               name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(handleRouteChange(_:)),
                                               name: AVAudioSession.routeChangeNotification, object: nil)
    }

    var currentRoute: String {
        AVAudioSession.sharedInstance().currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: "+")
    }

    var isBusy: Bool { synthesizer.isSpeaking || player?.isPlaying == true || recognitionTask != nil }

    // MARK: Speaking

    /// Interrupts anything Pudle is already saying: the newest alert matters most.
    func speak(_ text: String, cloud: Bool = true, completion: @escaping (Outcome) -> Void) {
        generation += 1
        let myGeneration = generation
        stopPlayback()
        guard activatePlayback() else {
            completion(.failed("Audio session unavailable"))
            return
        }
        if cloud, useCloudVoice, let cloudVoice {
            let persona = self.persona
            let timeout = cloudTimeout
            Task {
                let audio: Data? = await withTaskGroup(of: Data?.self) { group in
                    group.addTask { try? await cloudVoice(text, persona) }
                    group.addTask { try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000)); return nil }
                    let first = await group.next() ?? nil
                    group.cancelAll()
                    return first
                }
                guard myGeneration == self.generation else { return }  // superseded
                if let audio, self.play(audio, persona: persona, completion: completion) { return }
                self.speakOnDevice(text, completion: completion)
            }
        } else {
            speakOnDevice(text, completion: completion)
        }
    }

    private func play(_ audio: Data, persona: Persona, completion: @escaping (Outcome) -> Void) -> Bool {
        guard let player = try? AVAudioPlayer(data: audio) else { return false }
        player.delegate = self
        self.player = player
        playerCompletion = completion
        guard player.play() else { return false }
        completion(.started(Date(), voice: "gemini:\(persona.rawValue)"))
        return true
    }

    private func speakOnDevice(_ text: String, completion: @escaping (Outcome) -> Void) {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.04
        utterance.prefersAssistiveTechnologySettings = false
        callbacks[ObjectIdentifier(utterance)] = completion
        synthesizer.speak(utterance)
    }

    private func activatePlayback() -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            // .voicePrompt is the mode for navigation-style spoken prompts. .duckOthers lowers music;
            // .interruptSpokenAudioAndMixWithOthers pauses podcasts while mixing with Maps prompts.
            try session.setCategory(.playback, mode: .voicePrompt,
                                    options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
            try session.setActive(true)
            return true
        } catch {
            return false
        }
    }

    private func stopPlayback() {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
        if let player, player.isPlaying {
            player.stop()
            playerCompletion?(.failed("Cancelled by a newer alert or stop"))
        }
        player = nil
        playerCompletion = nil
    }

    func stopAll() {
        generation += 1
        stopPlayback()
        stopListening(deliver: false)
        deactivate()
    }

    private func deactivate() {
        guard !synthesizer.isSpeaking, player?.isPlaying != true, recognitionTask == nil else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        let key = ObjectIdentifier(utterance)
        let at = Date()
        Task { @MainActor in self.callbacks[key]?(.started(at, voice: "on-device")) }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let key = ObjectIdentifier(utterance)
        let at = Date()
        Task { @MainActor in
            self.callbacks.removeValue(forKey: key)?(.finished(at))
            self.deactivate()
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let key = ObjectIdentifier(utterance)
        Task { @MainActor in
            self.callbacks.removeValue(forKey: key)?(.failed("Cancelled by a newer alert or stop"))
            self.deactivate()
        }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        let at = Date()
        Task { @MainActor in
            let completion = self.playerCompletion
            self.playerCompletion = nil
            self.player = nil
            completion?(flag ? .finished(at) : .failed("Playback failed"))
            self.deactivate()
        }
    }

    // MARK: Listening

    static func requestListeningPermission() async -> Bool {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }

    /// Listens up to `seconds` for "report it" / "cancel". Calls back once with the intent
    /// (or .unknown on silence/timeout/error) and the transcript (shown on screen, never stored).
    func listen(seconds: TimeInterval, completion: @escaping (VoiceIntent, String) -> Void) {
        stopListening(deliver: false)
        guard let recognizer, recognizer.isAvailable else {
            completion(.unknown, "")
            return
        }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .spokenAudio,
                                    options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
        } catch {
            completion(.unknown, "")
            return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        request.contextualStrings = ["report it", "cancel", "go ahead", "yes", "no"]
        recognitionRequest = request
        lastTranscript = ""
        listenCompletion = completion

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else {
            stopListening(deliver: true)
            return
        }
        if tapInstalled { input.removeTap(onBus: 0) }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        tapInstalled = true
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            stopListening(deliver: true)
            return
        }
        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString ?? ""
            let isFinal = result?.isFinal ?? false
            Task { @MainActor in
                guard let self else { return }
                if !text.isEmpty { self.lastTranscript = text }
                if VoiceIntent.parse(text) != .unknown || isFinal || error != nil {
                    self.stopListening(deliver: true)
                }
            }
        }
        listenTimer = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.stopListening(deliver: true)
        }
    }

    private func stopListening(deliver: Bool) {
        listenTimer?.cancel()
        listenTimer = nil
        if audioEngine.isRunning { audioEngine.stop() }
        if tapInstalled { audioEngine.inputNode.removeTap(onBus: 0); tapInstalled = false }
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        let completion = listenCompletion
        listenCompletion = nil
        if deliver, let completion {
            completion(VoiceIntent.parse(lastTranscript), lastTranscript)
        }
        deactivate()
    }

    // MARK: Interruptions

    @objc nonisolated private func handleInterruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        Task { @MainActor in
            switch type {
            case .began:
                self.lastInterruption = "Audio interrupted (for example a phone call)"
            case .ended:
                self.lastInterruption = nil
            @unknown default:
                break
            }
            self.onInterruptionChange?(self.lastInterruption)
        }
    }

    @objc nonisolated private func handleRouteChange(_ note: Notification) {
        Task { @MainActor in self.onInterruptionChange?(self.lastInterruption) }
    }
}
