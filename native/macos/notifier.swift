// SPDX-License-Identifier: GPL-2.0-or-later
// This helper owns only a nonactivating native panel. It never captures media.
import Cocoa
import CoreGraphics

func emit(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) {
        FileHandle.standardOutput.write(data + Data([10]))
    }
}

func smooth(_ value: Double) -> Double {
    let value = max(0, min(1, value))
    return value * value * (3 - 2 * value)
}
func confirmationScale(_ age: Double?, from: Double) -> Double {
    guard let age = age else { return 1 }
    if age < 0.055 { return from + (0.9 - from) * (1 - pow(1 - age / 0.055, 3)) }
    if age < 0.17 { return 0.9 + 0.125 * smooth((age - 0.055) / 0.115) }
    if age < 0.34 { return 1.025 - 0.025 * smooth((age - 0.17) / 0.17) }
    return 1
}

final class FeedbackPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class FeedbackView: NSView {
    var message = ""
    var detail = "AcroClip"
    var artwork: NSImage?
    var confirmationAge: Double?
    var imageFromScale = 1.0
    var artworkData = ""
    var recordingStatus = ""
    var recordPulseAge: Double?
    var previousMessage = "", previousDetail = ""
    var previousFailure = false
    var textChangedAt = 0.0, textFromOpacity = 1.0
    var textTransition = false
    func textFrame(_ now: Double) -> (message: String, detail: String, failure: Bool, opacity: Double, offset: Double) {
        if !textTransition { return (message, detail, failure, 1, 0) }
        let age = now - textChangedAt
        if age < 0.065 {
            let progress = smooth(age / 0.065)
            return (previousMessage, previousDetail, previousFailure, textFromOpacity * (1 - progress), -2 * progress)
        }
        let progress = smooth((age - 0.065) / 0.115)
        return (message, detail, failure, progress, 3 * (1 - progress))
    }
    func changeText(_ title: String, _ subtitle: String, _ nextFailure: Bool, visible: Bool, now: Double) {
        if visible && (title != message || subtitle != detail || nextFailure != failure) {
            if !textTransition || now - textChangedAt >= 0.065 {
                let current = textFrame(now)
                previousMessage = current.message; previousDetail = current.detail; previousFailure = current.failure
                textFromOpacity = current.opacity; textChangedAt = now; textTransition = true
            }
        } else if !visible { textTransition = false }
        message = title; detail = subtitle
    }
    var backgroundOffset = 0.0
    var contentOffset = 0.0
    var failure = false
    var saving = false
    var phase = 0.0
    override var isOpaque: Bool { false }
    override func draw(_ dirtyRect: NSRect) {
        let padding = AffineTransform(translationByX: 12, byY: 12)
        (padding as NSAffineTransform).concat()
        NSColor(srgbRed: 17.0 / 255, green: 17.0 / 255, blue: 19.0 / 255, alpha: 1).setFill()
        // Extend the right corners outside the display so the panel joins its edge.
        let shape = NSBezierPath(roundedRect: NSRect(x: 8 + backgroundOffset, y: 8, width: 440, height: 88), xRadius: 20, yRadius: 20)
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.5)
        shadow.shadowBlurRadius = 12
        shadow.shadowOffset = NSSize(width: 0, height: -3)
        shadow.set()
        shape.fill()
        NSGraphicsContext.restoreGraphicsState()
        NSGraphicsContext.saveGraphicsState()
        shape.addClip()
        let motion = AffineTransform(translationByX: contentOffset, byY: 0)
        (motion as NSAffineTransform).concat()
        let accent = failure
            ? NSColor(srgbRed: 250.0 / 255, green: 137.0 / 255, blue: 137.0 / 255, alpha: 1)
            : NSColor(srgbRed: 177.0 / 255, green: 151.0 / 255, blue: 252.0 / 255, alpha: 1)
        if recordingStatus.isEmpty {
            let imageScale = confirmationScale(confirmationAge, from: imageFromScale)
            var flash = 0.0
            if let age = confirmationAge, age < 0.42 {
                flash = age < 0.035 ? 0.22 * age / 0.035 : 0.22 * exp(-(age - 0.035) / 0.065)
                let pulse = min(1, age / 0.42)
                let expansion = 14 * (1 - pow(1 - pulse, 3))
                let wave = NSBezierPath(roundedRect: NSRect(x: 20 - expansion, y: 20 - expansion, width: 64 + 2 * expansion, height: 64 + 2 * expansion), xRadius: 15 + expansion, yRadius: 15 + expansion)
                let opacity = pow(1 - pulse, 2)
                accent.withAlphaComponent(24.0 / 255 * opacity).setFill(); wave.fill()
                accent.withAlphaComponent(110.0 / 255 * opacity).setStroke(); wave.lineWidth = 2; wave.stroke()
            }
            let imageSide = 64 * imageScale
            let tile = NSRect(x: 52 - imageSide / 2, y: 52 - imageSide / 2, width: imageSide, height: imageSide)
            NSGraphicsContext.saveGraphicsState()
            NSBezierPath(roundedRect: tile, xRadius: 15 * imageScale, yRadius: 15 * imageScale).addClip()
            NSColor(srgbRed: 40.0 / 255, green: 37.0 / 255, blue: 47.0 / 255, alpha: 1).setFill()
            tile.fill()
            NSGraphicsContext.current?.imageInterpolation = .high
            if let image = artwork, image.size.width > 0, image.size.height > 0 {
                let side = min(image.size.width, image.size.height)
                image.draw(in: tile, from: NSRect(x: (image.size.width - side) / 2, y: (image.size.height - side) / 2, width: side, height: side), operation: .sourceOver, fraction: 1)
            }
            if flash > 0 { NSColor.white.withAlphaComponent(flash).setFill(); tile.fill() }
            if saving { NSColor.black.withAlphaComponent(0.45).setFill(); tile.fill() }
            NSGraphicsContext.restoreGraphicsState()
            let icon = NSBezierPath()
            icon.lineWidth = saving ? 3.5 : 2.3
            icon.lineCapStyle = .round
            icon.lineJoinStyle = .round
            if saving {
                NSColor.white.withAlphaComponent(0.25).setStroke()
                let track = NSBezierPath(ovalIn: NSRect(x: 31, y: 31, width: 42, height: 42))
                track.lineWidth = 3.5; track.stroke()
                icon.appendArc(withCenter: NSPoint(x: 52, y: 52), radius: 21,
                               startAngle: CGFloat(-phase * 360), endAngle: CGFloat(-phase * 360 + 265))
            } else if failure {
                NSColor(srgbRed: 28.0 / 255, green: 26.0 / 255, blue: 33.0 / 255, alpha: 1).setFill()
                NSBezierPath(ovalIn: NSRect(x: 61, y: 18, width: 25, height: 25)).fill()
                icon.move(to: NSPoint(x: 73.5, y: 37)); icon.line(to: NSPoint(x: 73.5, y: 30))
                icon.move(to: NSPoint(x: 73.5, y: 26)); icon.line(to: NSPoint(x: 73.5, y: 25.7))
            }
            accent.setStroke(); icon.stroke()
        } else {
            if let age = recordPulseAge, recordingStatus == "recording" {
                let progress = min(1, age / 0.46)
                let radius = 12 + 22 * (1 - pow(1 - progress, 3))
                let opacity = pow(1 - progress, 2)
                let wave = NSBezierPath(ovalIn: NSRect(x: 52 - radius, y: 52 - radius, width: radius * 2, height: radius * 2))
                accent.withAlphaComponent(22.0 / 255 * opacity).setFill(); wave.fill()
                accent.withAlphaComponent(140.0 / 255 * opacity).setStroke(); wave.lineWidth = 2.5; wave.stroke()
            }
            let color = recordingStatus == "error" ? NSColor(srgbRed: 250.0 / 255, green: 137.0 / 255, blue: 137.0 / 255, alpha: 1)
                : recordingStatus == "recording" ? NSColor(srgbRed: 244.0 / 255, green: 95.0 / 255, blue: 117.0 / 255, alpha: 1)
                : recordingStatus == "starting" ? accent : NSColor(srgbRed: 162.0 / 255, green: 159.0 / 255, blue: 169.0 / 255, alpha: 1)
            color.withAlphaComponent(60.0 / 255).setStroke()
            let track = NSBezierPath(ovalIn: NSRect(x: 30, y: 30, width: 44, height: 44)); track.lineWidth = 2.5; track.stroke()
            color.setFill(); color.setStroke()
            if recordingStatus == "starting" {
                let arc = NSBezierPath(); arc.lineWidth = 2.5; arc.lineCapStyle = .round
                arc.appendArc(withCenter: NSPoint(x: 52, y: 52), radius: 22, startAngle: CGFloat(-phase * 360), endAngle: CGFloat(-phase * 360 + 250)); arc.stroke()
                NSBezierPath(ovalIn: NSRect(x: 47, y: 47, width: 10, height: 10)).fill()
            } else if recordingStatus == "recording" {
                NSBezierPath(ovalIn: NSRect(x: 41, y: 41, width: 22, height: 22)).fill()
            } else if recordingStatus == "error" {
                let mark = NSBezierPath(); mark.lineWidth = 3; mark.lineCapStyle = .round
                mark.move(to: NSPoint(x: 52, y: 63)); mark.line(to: NSPoint(x: 52, y: 50)); mark.stroke()
                NSBezierPath(ovalIn: NSRect(x: 50.5, y: 41, width: 3, height: 3)).fill()
            } else { NSBezierPath(roundedRect: NSRect(x: 43, y: 43, width: 18, height: 18), xRadius: 4, yRadius: 4).fill() }
        }
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        let label = textFrame(ProcessInfo.processInfo.systemUptime)
        let sameTitle = previousMessage == message
        label.message.draw(in: NSRect(x: 100, y: 49 - (sameTitle ? 0 : label.offset), width: 279, height: 26), withAttributes: [
            .font: NSFont.systemFont(ofSize: 17, weight: .semibold),
            .foregroundColor: NSColor(srgbRed: 245.0 / 255, green: 244.0 / 255, blue: 247.0 / 255, alpha: sameTitle ? 1 : label.opacity),
            .paragraphStyle: paragraph,
        ])
        label.detail.draw(in: NSRect(x: 100, y: 27 - label.offset, width: 279, height: 20), withAttributes: [
            .font: NSFont.systemFont(ofSize: 12),
            .foregroundColor: NSColor(srgbRed: 162.0 / 255, green: 159.0 / 255, blue: 169.0 / 255, alpha: label.opacity),
            .paragraphStyle: paragraph,
        ])
        NSGraphicsContext.restoreGraphicsState()
    }
}

final class Feedback {
    let panel: FeedbackPanel
    let view: FeedbackView
    var timer: Timer?
    var started = 0.0
    var entered = 0.0
    var completing = false
    var confirmedAt = 0.0, returningAt = 0.0, spinningAt = 0.0, refreshedAt = 0.0
    var recordPulseAt: Double?
    var refreshFrom = 0.0
    var returnBackground = 0.0, returnContent = 0.0
    var continuing = false
    var sound: NSSound?
    var lifetime = 2.4
    var target = NSRect.zero
    var reducedMotion = false
    var proofPath: String?
    var proofWritten = false
    var tracking = false
    var shownReported = false
    var messageID: String?
    init() {
        view = FeedbackView(frame: NSRect(x: 0, y: 0, width: 420, height: 128))
        panel = FeedbackPanel(contentRect: view.frame, styleMask: [.borderless, .nonactivatingPanel],
                              backing: .buffered, defer: false)
        panel.contentView = view
        panel.title = "AcroClip feedback"
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isFloatingPanel = true
        panel.worksWhenModal = true
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        // sharingType.none does not exclude windows from modern macOS capture.
    }
    func metrics(_ event: String, requestID: String? = nil) {
        var result: [String: Any] = [
            "event": event, "windowId": panel.windowNumber, "visible": panel.isVisible,
            "key": panel.isKeyWindow, "main": panel.isMainWindow, "active": NSApp.isActive,
            "foregroundPID": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
            "alpha": panel.alphaValue, "x": panel.frame.minX, "y": panel.frame.minY,
            "width": panel.frame.width, "height": panel.frame.height,
            "backgroundOffset": view.backgroundOffset, "contentOffset": view.contentOffset, "continuing": continuing,
            "reducedMotion": reducedMotion, "timerActive": timer != nil,
            "elapsed": ProcessInfo.processInfo.systemUptime - started,
        ]
        if let id = requestID ?? messageID { result["id"] = id }
        emit(result)
    }
    func show(_ data: [String: Any]) {
        if let file = data["sound"] as? String {
            sound?.stop()
            sound = NSSound(contentsOfFile: file, byReference: false)
            sound?.play()
        }
        if data["visual"] as? Bool == false {
            if data["preserveBanner"] as? Bool != true { panel.orderOut(nil); timer?.invalidate(); timer = nil }
            return
        }
        let wasVisible = panel.isVisible
        continuing = wasVisible
        let now = ProcessInfo.processInfo.systemUptime
        if data["pulse"] as? Bool == true { recordPulseAt = now }
        else if !wasVisible { recordPulseAt = nil }
        let nextFailure = data["error"] as? Bool ?? false
        let nextSaving = data["saving"] as? Bool ?? false
        if !wasVisible || (!view.saving && nextSaving) { spinningAt = now }
        let completed = (data["completed"] as? Bool ?? (wasVisible && view.saving)) && !nextSaving && !nextFailure
        if wasVisible && !view.saving && now - started > lifetime {
            returnBackground = view.backgroundOffset; returnContent = view.contentOffset; returningAt = now
        } else if !wasVisible { returningAt = 0; returnBackground = 0; returnContent = 0 }
        if wasVisible && nextSaving && !nextFailure && (data["replay"] as? Bool ?? true) {
            refreshFrom = view.contentOffset; refreshedAt = now; returnContent = 0
        } else if !wasVisible { refreshedAt = 0 }
        if completed {
            view.imageFromScale = wasVisible ? confirmationScale(completing ? now - confirmedAt : nil, from: view.imageFromScale) : 1
            confirmedAt = now; completing = true
        } else if !wasVisible || nextFailure { completing = false }
        guard let text = data["message"] as? String, !text.isEmpty else { return }
        let title = nextFailure ? String((data["errorTitle"] as? String ?? "AcroClip needs attention").prefix(4000)) : String(text.prefix(4000))
        let subtitle = nextFailure && data["errorTitle"] == nil ? String(text.prefix(4000)) : String((data["detail"] as? String ?? "AcroClip").prefix(4000))
        view.changeText(title, subtitle, nextFailure, visible: wasVisible, now: now)
        view.recordingStatus = data["recordingStatus"] as? String ?? ""
        let artworkData = view.recordingStatus.isEmpty ? data["artwork"] as? String ?? "" : ""
        if artworkData != view.artworkData {
            view.artworkData = artworkData; view.artwork = nil
            if artworkData.hasPrefix("data:image/"), let comma = artworkData.firstIndex(of: ","), artworkData.utf8.count <= 2 * 1024 * 1024,
               let bytes = Data(base64Encoded: String(artworkData[artworkData.index(after: comma)...])) {
                view.artwork = NSImage(data: bytes)
            }
        }
        view.failure = nextFailure; view.saving = nextSaving
        proofPath = data["proofPath"] as? String
        tracking = data["trackAnimation"] as? Bool ?? false
        messageID = data["id"] as? String
        proofWritten = false
        shownReported = false
        reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if reducedMotion { view.textTransition = false }
        lifetime = view.failure ? 6.5 : 3.2
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.main else { return }
        let area = screen.visibleFrame
        target = NSRect(x: screen.frame.maxX - 420, y: area.maxY - 136, width: 420, height: 128)
        panel.setFrame(target, display: false)
        panel.alphaValue = 1
        view.needsDisplay = true
        panel.orderFrontRegardless()
        timer?.invalidate()
        timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer!, forMode: .common)
        // Window ordering can block. Start timing after it completes so the
        // first tick does not skip most of the entry animation on a busy host.
        started = ProcessInfo.processInfo.systemUptime
        if !wasVisible { entered = started }
        if !wasVisible { view.backgroundOffset = reducedMotion ? 0 : 408; view.contentOffset = reducedMotion ? 0 : 96 }
        if tracking { metrics("entry") }
        tick()
    }
    func tick() {
        let elapsed = ProcessInfo.processInfo.systemUptime - started
        let entryAge = ProcessInfo.processInfo.systemUptime - entered
        let leaving = view.saving ? 0 : max(0, min(1, (elapsed - lifetime) / 0.26))
        let remaining = 1 - max(0, min(1, entryAge / 0.28))
        let backgroundRest = 1.6 * pow(remaining, 3) - 0.6 * pow(remaining, 2)
        let contentRest = entryAge >= 0.48 ? 0 : exp(-14 * entryAge) * (cos(18 * entryAge) + (14.0 / 18.0) * sin(18 * entryAge))
        let returnRest = returningAt > 0 ? 1 - smooth((ProcessInfo.processInfo.systemUptime - returningAt) / 0.16) : 0
        view.backgroundOffset = reducedMotion ? 0 : 408 * backgroundRest + 408 * pow(leaving, 3) + returnBackground * returnRest
        var contentEntrance = 96 * contentRest
        if refreshedAt > 0 {
            let age = ProcessInfo.processInfo.systemUptime - refreshedAt
            if age < 0.06 { contentEntrance = refreshFrom + (64 - refreshFrom) * smooth(age / 0.06) }
            else {
                let rest = 1 - max(0, min(1, (age - 0.06) / 0.28))
                contentEntrance = 64 * (1.6 * pow(rest, 3) - 0.6 * pow(rest, 2))
            }
        }
        view.contentOffset = reducedMotion ? 0 : contentEntrance + 96 * pow(leaving, 3) + returnContent * returnRest
        view.needsDisplay = true
        view.recordPulseAge = reducedMotion ? nil : recordPulseAt.map { ProcessInfo.processInfo.systemUptime - $0 }
        view.confirmationAge = completing && !reducedMotion ? ProcessInfo.processInfo.systemUptime - confirmedAt : nil
        if view.saving { view.phase = reducedMotion ? 0 : (ProcessInfo.processInfo.systemUptime - spinningAt).truncatingRemainder(dividingBy: 1.28) / 1.28 }
        if view.saving || completing { view.needsDisplay = true }
        if tracking && (entryAge <= 0.48 || leaving > 0) { metrics("animation") }
        if (reducedMotion || entryAge >= 0.48) && !shownReported {
            shownReported = true
            view.displayIfNeeded()
            if let file = proofPath, let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
                view.cacheDisplay(in: view.bounds, to: bitmap)
                if let png = bitmap.representation(using: .png, properties: [:]) {
                    do { try png.write(to: URL(fileURLWithPath: file), options: .atomic); proofWritten = true }
                    catch { FileHandle.standardError.write(Data("Feedback image could not save: \(error)\n".utf8)) }
                }
            }
            metrics("shown")
        }
        if !view.saving && elapsed >= lifetime + 0.26 {
            panel.orderOut(nil)
            timer?.invalidate(); timer = nil
            metrics("hidden")
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let feedback = Feedback()
emit(["event": "ready", "pid": ProcessInfo.processInfo.processIdentifier,
      "bundleIdentifier": Bundle.main.bundleIdentifier ?? ""])
DispatchQueue.global(qos: .utility).async {
    while let line = readLine() {
        guard let bytes = line.data(using: .utf8),
              let data = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { continue }
        DispatchQueue.main.async {
            if data["action"] as? String == "exit" { app.terminate(nil) }
            else if data["action"] as? String == "metrics" { feedback.metrics("metrics", requestID: data["id"] as? String) }
            else { feedback.show(data) }
        }
    }
    DispatchQueue.main.async { app.terminate(nil) }
}
app.run()
