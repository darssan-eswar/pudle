import AVFoundation

/// Speaks fixed alert phrases. The audio session is active only while an utterance is
/// playing: no silent audio, no keep-alive. Audio playback from the background relies
/// on the `audio` background mode, used here exactly as navigation apps use it for
/// spoken prompts; it does not keep Pudle running by itself.
@MainActor
final class SpeechService: NSObject, AVSpeechSynthesizerDelegate {
    enum Outcome {
        case started(Date)
        case finished(Date)
        case failed(String)
    }

    private let synthesizer = AVSpeechSynthesizer()
    private var callbacks: [ObjectIdentifier: (Outcome) -> Void] = [:]
    private(set) var lastInterruption: String?
    var onInterruptionChange: ((String?) -> Void)?

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

    /// Interrupts anything Pudle is already saying: the newest alert matters most.
    func speak(_ text: String, completion: @escaping (Outcome) -> Void) {
        let session = AVAudioSession.sharedInstance()
        do {
            // .voicePrompt is the mode intended for navigation-style spoken prompts.
            // .duckOthers lowers music; .interruptSpokenAudioAndMixWithOthers pauses
            // podcasts/audiobooks while mixing with other audio such as Maps prompts.
            try session.setCategory(.playback, mode: .voicePrompt,
                                    options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
            try session.setActive(true)
        } catch {
            completion(.failed("Audio session unavailable: \((error as NSError).code)"))
            return
        }
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 1.02
        utterance.prefersAssistiveTechnologySettings = false
        callbacks[ObjectIdentifier(utterance)] = completion
        synthesizer.speak(utterance)
    }

    func stopAll() {
        synthesizer.stopSpeaking(at: .immediate)
        deactivate()
    }

    private func deactivate() {
        guard !synthesizer.isSpeaking else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        let key = ObjectIdentifier(utterance)
        let at = Date()
        Task { @MainActor in self.callbacks[key]?(.started(at)) }
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
