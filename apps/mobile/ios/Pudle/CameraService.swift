import AVFoundation
import CoreImage
import UIKit

/// Rear-camera dashcam feed. Keeps only the newest frame in memory; `snapshotJPEG` turns it into
/// a small JPEG for the hazard checker. Nothing is recorded or saved to disk. iOS stops the
/// camera when Pudle leaves the screen, so dashcam mode only works with Pudle in front.
final class CameraService: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "pudle.camera")
    private let context = CIContext(options: [.useSoftwareRenderer: false])
    private var latest: CVPixelBuffer?
    private var latestAt: Date?
    private let lock = NSLock()
    private var configured = false

    static func requestAccess() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .video)
        default: return false
        }
    }

    func start() {
        queue.async { [self] in
            if !configured { configure() }
            if !session.isRunning { session.startRunning() }
        }
    }

    func stop() {
        queue.async { [self] in
            if session.isRunning { session.stopRunning() }
            lock.lock(); latest = nil; latestAt = nil; lock.unlock()
        }
    }

    var isRunning: Bool { session.isRunning }

    private func configure() {
        session.beginConfiguration()
        session.sessionPreset = .hd1280x720
        if let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
           let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) {
            session.addInput(input)
            try? device.lockForConfiguration()
            device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 15)
            device.unlockForConfiguration()
        }
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.setSampleBufferDelegate(self, queue: queue)
        if session.canAddOutput(output) { session.addOutput(output) }
        if let connection = output.connection(with: .video), connection.isVideoRotationAngleSupported(0) {
            // Landscape dash mount: keep the sensor's native landscape orientation.
            connection.videoRotationAngle = 0
        }
        session.commitConfiguration()
        configured = true
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lock.lock(); latest = buffer; latestAt = Date(); lock.unlock()
    }

    /// Newest frame (if under 1 s old) as a JPEG about 640 px wide, plus its capture time.
    func snapshotJPEG(orientation: UIDeviceOrientation, maxWidth: CGFloat = 640, quality: CGFloat = 0.55) -> (Data, Date)? {
        lock.lock()
        let buffer = latest
        let at = latestAt
        lock.unlock()
        guard let buffer, let at, Date().timeIntervalSince(at) < 1 else { return nil }
        var image = CIImage(cvPixelBuffer: buffer)
        // The sensor buffer is landscape-left native. Rotate so the road is upright for the model.
        switch orientation {
        case .landscapeLeft: break
        case .landscapeRight: image = image.oriented(.down)
        case .portraitUpsideDown: image = image.oriented(.left)
        default: image = image.oriented(.right)   // portrait mount (or unknown)
        }
        let scale = min(1, maxWidth / image.extent.width)
        image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cg = context.createCGImage(image, from: image.extent) else { return nil }
        guard let data = UIImage(cgImage: cg).jpegData(compressionQuality: quality) else { return nil }
        return (data, at)
    }
}
