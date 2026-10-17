import AppKit
import WebKit
import UniformTypeIdentifiers
import PDFKit
import AVFoundation
import AudioToolbox
import CoreMIDI

// Ignore command results explicitly: WebKit cannot bridge Promise objects.
private func nativeJavaScriptCommand(_ script: String, expectsResult: Bool) -> String {
    return expectsResult ? script : "(()=>{\(script);return null;})()"
}

// Each staff owns a sampler so its GM patch and volume remain independent.
// The soundbank belongs to macOS and is never copied into the application.
final class NativePlayback {
    private let engine = AVAudioEngine()
    private let soundbank = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
    private var samplers: [AVAudioUnitSampler] = []
    private var programs: [Int?] = []
    private var scheduled: [DispatchWorkItem] = []
    private var activeNotes: [Int: [UInt8: Int]] = [:]
    private var generation = 0

    private func sampler(at index: Int, program: Int, volume: Double, percussion: Bool = false) throws -> AVAudioUnitSampler {
        while samplers.count <= index {
            let sampler = AVAudioUnitSampler()
            engine.attach(sampler)
            engine.connect(sampler, to: engine.mainMixerNode, format: nil)
            samplers.append(sampler)
            programs.append(nil)
        }
        let sampler = samplers[index]
        let patch = percussion ? 0 : max(0, min(127, program))
        let identity = patch + (percussion ? 128 : 0)
        if programs[index] != identity {
            let bankMSB = percussion ? kAUSampler_DefaultPercussionBankMSB : kAUSampler_DefaultMelodicBankMSB
            try sampler.loadSoundBankInstrument(at: soundbank, program: UInt8(patch), bankMSB: UInt8(bankMSB), bankLSB: 0)
            programs[index] = identity
        }
        let level = volume.isFinite ? max(0, min(1, volume)) : 0.8
        sampler.sendController(7, withValue: UInt8((level * 127).rounded()), onChannel: 0)
        return sampler
    }

    private func startEngine() throws {
        if !engine.isRunning { engine.prepare(); try engine.start() }
    }

    private func schedule(after seconds: Double, generation token: Int, _ operation: @escaping () -> Void) {
        let item = DispatchWorkItem { [weak self] in
            guard self?.generation == token else { return }
            operation()
        }
        scheduled.append(item)
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
    }

    private func begin(_ pitch: UInt8, velocity: UInt8, on sampler: AVAudioUnitSampler, index: Int) {
        activeNotes[index, default: [:]][pitch, default: 0] += 1
        sampler.startNote(pitch, withVelocity: velocity, onChannel: 0)
    }

    private func end(_ pitch: UInt8, on sampler: AVAudioUnitSampler, index: Int) {
        let remaining = max(0, (activeNotes[index]?[pitch] ?? 1) - 1)
        activeNotes[index]?[pitch] = remaining
        if remaining == 0 { sampler.stopNote(pitch, onChannel: 0) }
    }

    func stop() {
        generation += 1
        scheduled.forEach { $0.cancel() }
        scheduled.removeAll()
        activeNotes.removeAll()
        for sampler in samplers {
            sampler.sendController(64, withValue: 0, onChannel: 0)
            for pitch in UInt8(0)...UInt8(127) { sampler.stopNote(pitch, onChannel: 0) }
            sampler.sendController(123, withValue: 0, onChannel: 0)
            sampler.sendController(120, withValue: 0, onChannel: 0)
        }
    }

    func play(_ body: [String: Any]) throws {
        stop()
        guard let parts = body["parts"] as? [[String: Any]], parts.count <= 8 else {
            throw NSError(domain: "Partitura.Audio", code: 1, userInfo: [NSLocalizedDescriptionKey: "La reproducción admite hasta 8 pentagramas."])
        }
        // Prepare every patch before setting the shared starting time.
        var prepared: [(Int, AVAudioUnitSampler, [[String: Any]])] = []
        for (index, part) in parts.enumerated() {
            if part["muted"] as? Bool == true { continue }
            let instrument = try sampler(at: index, program: part["program"] as? Int ?? 0, volume: part["volume"] as? Double ?? 0.8, percussion: part["percussion"] as? Bool ?? false)
            prepared.append((index, instrument, part["notes"] as? [[String: Any]] ?? []))
        }
        try startEngine()
        let token = generation
        var lastEnd = 0.0
        for (index, instrument, notes) in prepared {
            for note in notes {
                guard let pitch = note["pitch"] as? Int, (0...127).contains(pitch),
                      let at = note["at"] as? Double, at.isFinite, at >= 0,
                      let duration = note["duration"] as? Double, duration.isFinite, duration > 0,
                      at + duration <= 86400 else { continue }
                let velocity = UInt8(max(1, min(127, note["velocity"] as? Int ?? 83)))
                let midi = UInt8(pitch)
                schedule(after: at + 0.12, generation: token) { [weak self] in self?.begin(midi, velocity: velocity, on: instrument, index: index) }
                schedule(after: at + duration + 0.12, generation: token) { [weak self] in self?.end(midi, on: instrument, index: index) }
                lastEnd = max(lastEnd, at + duration)
            }
        }
        schedule(after: lastEnd + 0.3, generation: token) { [weak self] in self?.stop() }
    }

    func audition(_ body: [String: Any]) throws {
        stop()
        guard let pitch = body["pitch"] as? Int, (0...127).contains(pitch) else { return }
        let instrument = try sampler(at: 8, program: body["program"] as? Int ?? 0, volume: body["volume"] as? Double ?? 0.6, percussion: body["percussion"] as? Bool ?? false)
        try startEngine()
        begin(UInt8(pitch), velocity: 88, on: instrument, index: 8)
        schedule(after: 0.25, generation: generation) { [weak self] in self?.stop() }
    }
}

// An independent offline engine keeps exporting separate from real-time playback.
// PCM is sent in bounded chunks; the worker waits for each WebKit delivery.
final class NativeAudioExporter {
    typealias Delivery = (String, [String: Any], @escaping (Error?) -> Void) -> Void
    private final class Job {
        let id: String
        private let lock = NSLock()
        private var cancelled = false
        init(_ id: String) { self.id = id }
        func cancel() { lock.lock(); cancelled = true; lock.unlock() }
        func check() throws {
            lock.lock(); let stopped = cancelled; lock.unlock()
            if stopped { throw NSError(domain: "RickMusic.AudioExport", code: 2, userInfo: [NSLocalizedDescriptionKey: "Exportación cancelada."]) }
        }
    }
    private final class ResultBox {
        private let lock = NSLock()
        private var value: Error?
        func set(_ error: Error?) { lock.lock(); value = error; lock.unlock() }
        func get() -> Error? { lock.lock(); defer { lock.unlock() }; return value }
    }
    private struct Event {
        let frame: Int64
        let part: Int
        let pitch: UInt8
        let velocity: UInt8
        let on: Bool
    }
    private let queue = DispatchQueue(label: "app.rickmusic.audio-export", qos: .userInitiated)
    private let deliver: Delivery
    private var current: Job?
    private let rate = 44100.0
    private let chunkFrames = 32768
    init(deliver: @escaping Delivery) { self.deliver = deliver }

    func start(_ body: [String: Any]) {
        current?.cancel()
        let identifier = body["jobId"] as? String ?? ""
        let job = Job(identifier)
        current = job
        queue.async { [self] in
            do {
                guard !identifier.isEmpty && identifier.count <= 128 else { throw failure("Identificador de exportación inválido.") }
                try render(body, job: job)
            } catch {
                DispatchQueue.main.async { [self] in
                    deliver("audioExportError", ["jobId": identifier, "message": error.localizedDescription]) { _ in }
                }
            }
            DispatchQueue.main.async { [weak self] in
                if self?.current === job { self?.current = nil }
            }
        }
    }

    func cancel(_ identifier: String? = nil) {
        if identifier == nil || current?.id == identifier { current?.cancel() }
    }

    private func failure(_ message: String) -> Error {
        NSError(domain: "RickMusic.AudioExport", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func emit(_ callback: String, _ data: [String: Any], job: Job) throws {
        try job.check()
        let semaphore = DispatchSemaphore(value: 0)
        let result = ResultBox()
        DispatchQueue.main.async { [self] in
            do { try job.check() }
            catch { result.set(error); semaphore.signal(); return }
            deliver(callback, data) { error in result.set(error); semaphore.signal() }
        }
        let limit = Date().addingTimeInterval(60)
        while semaphore.wait(timeout: .now() + 0.1) == .timedOut {
            try job.check()
            if Date() > limit { throw failure("La interfaz no respondió durante la exportación.") }
        }
        if let error = result.get() { throw error }
        try job.check()
    }

    private func render(_ body: [String: Any], job: Job) throws {
        guard let parts = body["parts"] as? [[String: Any]], !parts.isEmpty, parts.count <= 8,
              let duration = body["duration"] as? Double, duration.isFinite, duration >= 0, duration <= 1800 else {
            throw failure("La exportación admite hasta 8 pentagramas y 30 minutos de música.")
        }
        var events: [Event] = []
        var lastEnd = duration
        var noteCount = 0
        for (partIndex, part) in parts.enumerated() {
            if part["muted"] as? Bool == true { continue }
            let notes = part["notes"] as? [[String: Any]] ?? []
            noteCount += notes.count
            guard noteCount <= 200000 else { throw failure("La partitura supera 200.000 eventos de nota.") }
            for note in notes {
                guard let pitch = note["pitch"] as? Int, (0...127).contains(pitch),
                      let at = note["at"] as? Double, at.isFinite, at >= 0,
                      let length = note["duration"] as? Double, length.isFinite, length > 0,
                      at + length <= 1800 else { throw failure("Una nota tiene altura o duración inválida, o excede 30 minutos.") }
                let start = Int64((at * rate).rounded())
                let end = max(start + 1, Int64(((at + length) * rate).rounded()))
                let velocity = UInt8(max(1, min(127, note["velocity"] as? Int ?? 83)))
                events.append(Event(frame: start, part: partIndex, pitch: UInt8(pitch), velocity: velocity, on: true))
                events.append(Event(frame: end, part: partIndex, pitch: UInt8(pitch), velocity: 0, on: false))
                lastEnd = max(lastEnd, at + length)
            }
        }
        events.sort { a, b in a.frame == b.frame ? (a.on == b.on ? a.part < b.part : !a.on) : a.frame < b.frame }
        let musicalFrames = max(Int64((lastEnd * rate).rounded()), events.last?.frame ?? 0)
        let totalFrames = musicalFrames + 88200
        let engine = AVAudioEngine()
        let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2)!
        var samplers: [AVAudioUnitSampler] = []
        for _ in parts {
            let sampler = AVAudioUnitSampler()
            engine.attach(sampler)
            engine.connect(sampler, to: engine.mainMixerNode, format: nil)
            samplers.append(sampler)
        }
        try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 4096)
        try engine.start()
        defer { engine.stop(); engine.disableManualRenderingMode() }
        let bank = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
        for (index, part) in parts.enumerated() {
            try job.check()
            if part["muted"] as? Bool == true { continue }
            let percussion = part["percussion"] as? Bool ?? false
            let program = percussion ? 0 : max(0, min(127, part["program"] as? Int ?? 0))
            let bankMSB = percussion ? kAUSampler_DefaultPercussionBankMSB : kAUSampler_DefaultMelodicBankMSB
            try samplers[index].loadSoundBankInstrument(at: bank, program: UInt8(program), bankMSB: UInt8(bankMSB), bankLSB: 0)
            let requestedVolume = part["volume"] as? Double ?? 0.8
            let volume = requestedVolume.isFinite ? max(0, min(1, requestedVolume)) : 0.8
            samplers[index].sendController(7, withValue: UInt8((volume * 127).rounded()), onChannel: 0)
        }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else { throw failure("No se pudo reservar el búfer de audio.") }
        try emit("audioExportBegin", ["jobId": job.id, "sampleRate": 44100, "channels": 2, "frames": totalFrames], job: job)
        var active: [Int: [UInt8: Int]] = [:]
        var eventIndex = 0
        var rendered: Int64 = 0
        var sent: Int64 = 0
        var stalled = 0
        var left: [Int16] = [], right: [Int16] = []
        left.reserveCapacity(chunkFrames); right.reserveCapacity(chunkFrames)
        func flush() throws {
            guard !left.isEmpty else { return }
            let leftData = left.withUnsafeBytes { Data($0).base64EncodedString() }
            let rightData = right.withUnsafeBytes { Data($0).base64EncodedString() }
            sent += Int64(left.count)
            try emit("audioExportChunk", ["jobId": job.id, "left": leftData, "right": rightData, "progress": Double(sent) / Double(totalFrames)], job: job)
            left.removeAll(keepingCapacity: true); right.removeAll(keepingCapacity: true)
        }
        while rendered < totalFrames {
            try job.check()
            while eventIndex < events.count, events[eventIndex].frame <= rendered {
                let event = events[eventIndex], sampler = samplers[event.part]
                if event.on {
                    active[event.part, default: [:]][event.pitch, default: 0] += 1
                    sampler.startNote(event.pitch, withVelocity: event.velocity, onChannel: 0)
                } else {
                    let count = max(0, (active[event.part]?[event.pitch] ?? 1) - 1)
                    active[event.part]?[event.pitch] = count
                    if count == 0 { sampler.stopNote(event.pitch, onChannel: 0) }
                }
                eventIndex += 1
            }
            let boundary = eventIndex < events.count ? min(totalFrames, events[eventIndex].frame) : totalFrames
            let count = AVAudioFrameCount(min(Int64(4096), boundary - rendered))
            guard count > 0 else { continue }
            let status = try engine.renderOffline(count, to: buffer)
            switch status {
            case .success:
                guard buffer.frameLength > 0, let channels = buffer.floatChannelData else { throw failure("El motor no produjo muestras de audio.") }
                stalled = 0
                for frame in 0..<Int(buffer.frameLength) {
                    func pcm(_ value: Float) -> Int16 {
                        guard value.isFinite else { return 0 }
                        return Int16((max(-1, min(1, value)) * 32767).rounded()).littleEndian
                    }
                    left.append(pcm(channels[0][frame])); right.append(pcm(channels[1][frame]))
                    if left.count == chunkFrames { try flush() }
                }
                rendered += Int64(buffer.frameLength)
            case .cannotDoInCurrentContext, .insufficientDataFromInputNode:
                stalled += 1
                guard stalled <= 1000 else { throw failure("El motor de audio no pudo avanzar.") }
                Thread.sleep(forTimeInterval: 0.001)
            case .error: throw failure("El motor de audio rechazó la exportación.")
            @unknown default: throw failure("Estado de renderizado de audio no compatible.")
            }
        }
        try flush()
        try emit("audioExportEnd", ["jobId": job.id], job: job)
    }
}

// Receive external MIDI devices without changing the playback engine. Legacy
// CoreMIDI input ports accept MIDI 1.0 messages (including running status).
final class NativeMIDIInput {
    private struct Parser { var status: UInt8 = 0; var pending: [UInt8] = [] }
    private var client: MIDIClientRef = 0
    private var inputPort: MIDIPortRef = 0
    private var connected = Set<MIDIEndpointRef>()
    private var parsers: [MIDIEndpointRef: Parser] = [:]
    private var generation = 0
    private let onEvent: ([String: Any]) -> Void
    private let onStatus: ([String: Any]) -> Void

    init(onEvent: @escaping ([String: Any]) -> Void, onStatus: @escaping ([String: Any]) -> Void) {
        self.onEvent = onEvent
        self.onStatus = onStatus
    }

    func start() {
        stop(notify: false)
        generation += 1
        let token = generation
        let clientResult = MIDIClientCreateWithBlock("Rick Music MIDI" as CFString, &client) { [weak self] _ in
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.generation == token else { return }
                self.refreshSources()
            }
        }
        guard clientResult == noErr else { fail("No se pudo iniciar CoreMIDI (\(clientResult))."); return }
        let portResult = MIDIInputPortCreateWithBlock(client, "Rick Music Entrada" as CFString, &inputPort) { [weak self] packets, sourceRef in
            let source = MIDIEndpointRef(UInt(bitPattern: sourceRef))
            let offset = MemoryLayout<MIDIPacketList>.offset(of: \.packet)!
            var packet = UnsafeRawPointer(packets).advanced(by: offset).assumingMemoryBound(to: MIDIPacket.self)
            var batches: [(Double, [UInt8])] = []
            for _ in 0..<min(Int(packets.pointee.numPackets), 4096) {
                let dataOffset = MemoryLayout<MIDIPacket>.offset(of: \.data)!
                let bytes = UnsafeRawPointer(packet).advanced(by: dataOffset).assumingMemoryBound(to: UInt8.self)
                let hostTime = packet.pointee.timeStamp
                let timestamp = hostTime == 0 ? ProcessInfo.processInfo.systemUptime : AVAudioTime.seconds(forHostTime: hostTime)
                batches.append((timestamp, Array(UnsafeBufferPointer(start: bytes, count: Int(packet.pointee.length)))))
                packet = UnsafePointer(MIDIPacketNext(packet))
            }
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.generation == token, self.inputPort != 0 else { return }
                for (timestamp, bytes) in batches { self.receive(bytes, source: source, timestamp: timestamp) }
            }
        }
        guard portResult == noErr else { fail("No se pudo crear la entrada MIDI (\(portResult))."); return }
        refreshSources()
    }

    func stop(notify: Bool = true) {
        generation += 1
        if inputPort != 0 { MIDIPortDispose(inputPort); inputPort = 0 }
        if client != 0 { MIDIClientDispose(client); client = 0 }
        connected.removeAll()
        parsers.removeAll()
        if notify { publishStatus() }
    }

    private func fail(_ message: String) {
        stop(notify: false)
        publishStatus(error: message)
    }

    private func sourceName(_ endpoint: MIDIEndpointRef) -> String {
        var name: Unmanaged<CFString>?
        if MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &name) == noErr, let value = name {
            return value.takeRetainedValue() as String
        }
        return "Entrada MIDI \(endpoint)"
    }

    private func refreshSources() {
        guard inputPort != 0 else { return }
        let available = Set((0..<MIDIGetNumberOfSources()).map { MIDIGetSource($0) }.filter { $0 != 0 })
        for source in connected.subtracting(available) {
            MIDIPortDisconnectSource(inputPort, source)
            connected.remove(source)
            parsers.removeValue(forKey: source)
        }
        var errors: [String] = []
        for source in available.subtracting(connected) {
            let result = MIDIPortConnectSource(inputPort, source, UnsafeMutableRawPointer(bitPattern: UInt(source)))
            if result == noErr { connected.insert(source) }
            else { errors.append("\(sourceName(source)) (\(result))") }
        }
        publishStatus(error: errors.isEmpty ? "" : "No se pudo conectar: " + errors.joined(separator: ", "))
    }

    private func publishStatus(error: String = "") {
        let names = connected.sorted().map { sourceName($0) }
        onStatus(["active": inputPort != 0, "count": names.count, "names": names, "name": names.joined(separator: ", "), "error": error])
    }

    private func receive(_ bytes: [UInt8], source: MIDIEndpointRef, timestamp: Double) {
        var parser = parsers[source] ?? Parser()
        for byte in bytes {
            if byte >= 0xF8 { continue } // Real-time bytes may occur inside another message.
            if byte >= 0x80 {
                parser.pending.removeAll(keepingCapacity: true)
                parser.status = byte < 0xF0 ? byte : 0
                continue
            }
            guard parser.status >= 0x80 else { continue }
            parser.pending.append(byte)
            let kind = parser.status & 0xF0
            let required = (kind == 0xC0 || kind == 0xD0) ? 1 : 2
            guard parser.pending.count == required else { continue }
            if kind == 0x80 || kind == 0x90 {
                let pitch = Int(parser.pending[0]), velocity = Int(parser.pending[1])
                onEvent(["type": kind == 0x90 && velocity > 0 ? "on" : "off", "pitch": pitch, "velocity": velocity, "timestamp": timestamp, "channel": Int(parser.status & 0x0F), "source": Int(source)])
            }
            parser.pending.removeAll(keepingCapacity: true)
        }
        parsers[source] = parser
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var printWebView: WKWebView?
    private var printWindow: NSWindow?
    private var printDestination: URL?
    private var printRects: [CGRect] = []
    private var printData: Data?
    private var bypassClose = false
    private var checkingClose = false
    private var closeAfterSave = false
    private var allowTermination = false
    private var documentReady = false
    private var pendingDocuments: [URL] = []
    private let playback = NativePlayback()
    private lazy var midiInput = NativeMIDIInput(onEvent: { [weak self] event in self?.dispatchMIDI("midiEvent", event) }, onStatus: { [weak self] status in self?.dispatchMIDI("midiStatus", status) })

    private lazy var audioExporter = NativeAudioExporter(deliver: { [weak self] callback, data, completion in
        guard let self = self, let bytes = try? JSONSerialization.data(withJSONObject: data), let json = String(data: bytes, encoding: .utf8) else {
            completion(NSError(domain: "RickMusic.AudioExport", code: 3, userInfo: [NSLocalizedDescriptionKey: "La interfaz de exportación no está disponible."]))
            return
        }
        let script = "(()=>{const app=window.RickMusic||window.Partitura;if(!app||typeof app.\(callback)!=='function')throw new Error('Falta el receptor de exportación de audio');app.\(callback)(\(json));return null;})()"
        self.webView.evaluateJavaScript(script) { _, error in completion(error) }
    })

    private func dispatchMIDI(_ callback: String, _ data: [String: Any]) {
        guard let bytes = try? JSONSerialization.data(withJSONObject: data), let json = String(data: bytes, encoding: .utf8) else { return }
        evaluate("if(window.Partitura&&typeof window.Partitura.\(callback)==='function')window.Partitura.\(callback)(\(json))")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMenus()
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "native")
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 940), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Rick Music"
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 1000, height: 680)
        window.contentView = webView
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("PartituraMainWindow")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        guard let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            showError("No se encontró la interfaz de Rick Music en el paquete de la aplicación.")
            return
        }
        webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
    }

    private func installMenus() {
        let main = NSMenu()
        let appMenu = NSMenu(title: "Rick Music")
        appMenu.addItem(withTitle: "Acerca de Rick Music", action: #selector(about), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Ocultar Rick Music", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Ocultar otras", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h").keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Mostrar todo", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Salir de Rick Music", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        addMenu(appMenu, to: main)
        let file = NSMenu(title: "Archivo")
        addItem("Nueva partitura", action: #selector(newScore), key: "n", to: file)
        addItem("Abrir…", action: #selector(openDocument), key: "o", to: file)
        addItem("Guardar…", action: #selector(saveDocument), key: "s", to: file)
        file.addItem(.separator())
        addItem("Exportar MUSX…", action: #selector(exportMUSX), key: "", to: file)
        addItem("Exportar MusicXML…", action: #selector(exportXML), key: "", to: file)
        addItem("Exportar MIDI…", action: #selector(exportMIDI), key: "", to: file)
        addItem("Exportar MP3…", action: #selector(exportMP3), key: "", to: file)
        addItem("Exportar PDF…", action: #selector(exportPDF), key: "", to: file)
        addItem("Imprimir…", action: #selector(printDocument), key: "p", to: file)
        file.addItem(.separator())
        file.addItem(withTitle: "Cerrar ventana", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        addMenu(file, to: main)
        let edit = NSMenu(title: "Edición")
        addItem("Deshacer", action: #selector(undoScore), key: "z", to: edit)
        addItem("Rehacer", action: #selector(redoScore), key: "z", to: edit)
        edit.items.last?.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        for (title, selector, key, shift) in [("Cortar", "cut:", "x", false), ("Copiar", "copy:", "c", false), ("Pegar", "paste:", "v", false), ("Seleccionar todo", "selectAll:", "a", false)] {
            let item = edit.addItem(withTitle: title, action: NSSelectorFromString(selector), keyEquivalent: key)
            item.keyEquivalentModifierMask = shift ? [.command, .shift] : [.command]
        }
        addMenu(edit, to: main)
        let view = NSMenu(title: "Ventana")
        view.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        view.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        addMenu(view, to: main)
        NSApp.mainMenu = main
        NSApp.windowsMenu = view
    }

    private func addMenu(_ submenu: NSMenu, to menu: NSMenu) {
        let item = NSMenuItem(title: submenu.title, action: nil, keyEquivalent: "")
        item.submenu = submenu
        menu.addItem(item)
    }

    private func addItem(_ title: String, action: Selector, key: String, to menu: NSMenu) {
        menu.addItem(withTitle: title, action: action, keyEquivalent: key).target = self
    }

    private func evaluate(_ script: String, completion: ((Any?, Error?) -> Void)? = nil) {
        // Commands such as openFile/exportMUSX return Promises. WebKit cannot
        // bridge a Promise as an evaluateJavaScript result; ignore command
        // results explicitly while preserving values requested by callers.
        let command = nativeJavaScriptCommand(script, expectsResult: completion != nil)
        webView.evaluateJavaScript(command) { [weak self] value, error in
            if let completion = completion { completion(value, error) }
            else if let error = error { self?.showError("No se pudo completar la acción. \(error.localizedDescription)") }
        }
    }

    private func jsString(_ text: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [text], options: [.fragmentsAllowed])
        let array = String(data: data, encoding: .utf8)!
        return String(array.dropFirst().dropLast())
    }

    @objc private func about() {
        let alert = NSAlert()
        alert.messageText = "Rick Music"
        alert.informativeText = "Editor independiente de notación musical.\nVersión 0.2\nFunciona localmente y sin conexión."
        alert.runModal()
    }
    @objc private func newScore() { evaluate("window.Partitura.newScore()") }
    @objc private func undoScore() { routeUndoRedo("undo") }
    @objc private func redoScore() { routeUndoRedo("redo") }
    private func routeUndoRedo(_ command: String) {
        if let responder = window.firstResponder as? NSTextView, responder.isFieldEditor {
            if command == "undo" { responder.undoManager?.undo() }
            else { responder.undoManager?.redo() }
            return
        }
        evaluate("(()=>{const e=document.activeElement;const text=e&&(e.isContentEditable||e.tagName==='TEXTAREA'||(e.tagName==='INPUT'&&!['button','checkbox','radio','range','submit','reset','file','color'].includes(e.type)));if(text){document.execCommand('\(command)');}else{window.Partitura.\(command)();}})()")
    }
    @objc private func saveDocument() { evaluate("window.Partitura.save()") }
    @objc private func exportMUSX() { evaluate("window.Partitura.exportMUSX()") }
    @objc private func exportXML() { evaluate("window.Partitura.exportMusicXML()") }
    @objc private func exportMIDI() { evaluate("window.Partitura.exportMIDI()") }
    @objc private func exportMP3() { evaluate("window.RickMusic.exportMP3()") }
    @objc private func exportPDF() { preparePrint(savePDF: true) }
    @objc private func printDocument() { preparePrint(savePDF: false) }

    @objc private func openDocument() {
        let panel = NSOpenPanel()
        panel.title = "Abrir partitura"
        panel.allowedContentTypes = ["rickmusic", "partitura", "json", "musx", "musicxml", "xml", "mxl", "mid", "midi"].compactMap { UTType(filenameExtension: $0) }
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self = self, response == .OK, let url = panel.url else { return }
            do {
                let bytes = try Data(contentsOf: url)
                guard bytes.count <= 20_000_000 else { self.showError("El archivo supera 20 MB."); return }
                self.evaluate("window.Partitura.openFile(\(self.jsString(url.lastPathComponent)),\(self.jsString(bytes.base64EncodedString())))")
            } catch { self.showError("No se pudo abrir el archivo. \(error.localizedDescription)") }
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        if !documentReady { pendingDocuments.append(contentsOf: urls); return }
        if let url = urls.first { loadDocument(url) }
    }

    private func loadDocument(_ url: URL) {
        do {
            let bytes = try Data(contentsOf: url)
            guard bytes.count <= 20_000_000 else { showError("El archivo supera 20 MB."); return }
            evaluate("window.Partitura.openFile(\(jsString(url.lastPathComponent)),\(jsString(bytes.base64EncodedString())))")
        } catch { showError("No se pudo abrir el archivo. \(error.localizedDescription)") }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "open": openDocument()
        case "save": saveFile(body)
        case "pdf": preparePrint(savePDF: true)
        case "print": preparePrint(savePDF: false)
        case "play":
            do { try playback.play(body) }
            catch { reportAudioError(error) }
        case "stop": playback.stop()
        case "renderAudio": audioExporter.start(body)
        case "cancelAudioExport": audioExporter.cancel(body["jobId"] as? String)
        case "startMidi", "startMIDI": midiInput.start()
        case "stopMidi", "stopMIDI": midiInput.stop()
        case "audition":
            do { try playback.audition(body) }
            catch { reportAudioError(error) }
        default: break
        }
    }

    private func reportAudioError(_ error: Error) {
        playback.stop()
        evaluate("if(window.Partitura.audioError)window.Partitura.audioError(\(jsString(error.localizedDescription)))")
    }

    private func saveFile(_ body: [String: Any]) {
        guard let encoded = body["data"] as? String, let bytes = Data(base64Encoded: encoded) else {
            closeAfterSave = false
            showError("Los datos del archivo no son válidos.")
            return
        }
        let suggested = ((body["name"] as? String) ?? "Rick Music.rickmusic") as NSString
        let panel = NSSavePanel()
        panel.title = "Guardar archivo"
        panel.nameFieldStringValue = suggested.lastPathComponent
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { [weak self] response in
            guard let self = self else { return }
            guard response == .OK, let url = panel.url else {
                self.closeAfterSave = false
                self.notifySave(success: false, name: suggested.lastPathComponent)
                return
            }
            do {
                try bytes.write(to: url, options: .atomic)
                self.notifySave(success: true, name: url.lastPathComponent)
                if self.closeAfterSave { self.closeAfterSave = false; self.finishClose() }
            } catch {
                self.closeAfterSave = false
                self.notifySave(success: false, name: url.lastPathComponent)
                self.showError("No se pudo guardar el archivo. \(error.localizedDescription)")
            }
        }
    }

    private func notifySave(success: Bool, name: String) {
        evaluate("if(window.Partitura.nativeSaveResult)window.Partitura.nativeSaveResult(\(success),\(jsString(name)))")
    }

    private func preparePrint(savePDF: Bool) {
        guard printWebView == nil else { return }
        evaluate("window.Partitura.printHTML()") { [weak self] value, error in
            guard let self = self else { return }
            guard error == nil, let html = value as? String else {
                self.showError("No se pudo preparar la partitura para imprimir.")
                return
            }
            if savePDF {
                let panel = NSSavePanel()
                panel.title = "Exportar PDF"
                panel.nameFieldStringValue = "Rick Music.pdf"
                panel.allowedContentTypes = [.pdf]
                panel.beginSheetModal(for: self.window) { [weak self] response in
                    guard let self = self, response == .OK, let url = panel.url else { return }
                    self.renderForPrint(html, destination: url)
                }
            } else { self.renderForPrint(html, destination: nil) }
        }
    }

    private func renderForPrint(_ html: String, destination: URL?) {
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 794, height: 1123))
        view.navigationDelegate = self
        let holder = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        holder.contentView = view
        holder.isReleasedWhenClosed = false
        holder.setFrameOrigin(NSPoint(x: -10000, y: -10000))
        holder.orderBack(nil)
        printWebView = view
        printWindow = holder
        printDestination = destination
        view.loadHTMLString(html, baseURL: Bundle.main.url(forResource: "Web", withExtension: nil))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === printWebView else {
            if webView === self.webView { documentReady = true; if let url = pendingDocuments.first { pendingDocuments = []; loadDocument(url) } }
            return
        }
        Task { @MainActor [weak self] in
            guard let self = self else { return }
            do {
                let value = try await webView.callAsyncJavaScript("await document.fonts.ready; return Array.from(document.querySelectorAll('.sheet'),e=>{const r=e.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height};});", arguments: [:], in: nil, contentWorld: .page)
                guard let rectangles = value as? [[String: Double]], !rectangles.isEmpty else { self.printFailed("La partitura no contiene páginas."); return }
                self.printRects = rectangles.map { CGRect(x: $0["x"] ?? 0, y: $0["y"] ?? 0, width: $0["width"] ?? 0, height: $0["height"] ?? 0) }
                guard self.printRects.allSatisfy({ $0.width.isFinite && $0.height.isFinite && $0.width > 0 && $0.height > 0 }) else { self.printFailed("Las dimensiones de página no son válidas."); return }
                self.printData = nil
                self.capturePrintDocument()
            } catch { self.printFailed(error.localizedDescription) }
        }
    }

    private func capturePrintDocument() {
        guard let view = printWebView else { return }
        let configuration = WKPDFConfiguration()
        // Capture once so all pages share a consistent embedded font subset.
        configuration.rect = printRects.reduce(CGRect.null) { $0.union($1) }
        view.createPDF(configuration: configuration) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let data): self.printData = data; self.finishPrintPDF()
            case .failure(let error): self.printFailed(error.localizedDescription)
            }
        }
    }

    private func finishPrintPDF() {
        let bytes = NSMutableData()
        var paper = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)
        guard let consumer = CGDataConsumer(data: bytes as CFMutableData), let context = CGContext(consumer: consumer, mediaBox: &paper, nil) else { printFailed("No se pudo crear el PDF."); return }
        guard let sourceData = printData, let provider = CGDataProvider(data: sourceData as CFData), let source = CGPDFDocument(provider), let page = source.page(at: 1) else { context.closePDF(); printFailed("No se pudo procesar el PDF."); return }
        let bounds = page.getBoxRect(.mediaBox)
        let capture = printRects.reduce(CGRect.null) { $0.union($1) }
        for rect in printRects {
            let scale = min((paper.width - 48) / rect.width, (paper.height - 48) / rect.height)
            let target = CGRect(x: (paper.width - rect.width * scale) / 2, y: paper.height - 24 - rect.height * scale, width: rect.width * scale, height: rect.height * scale)
            let sourceX = bounds.minX + rect.minX - capture.minX
            let sourceY = bounds.maxY - (rect.maxY - capture.minY)
            context.beginPDFPage(nil)
            context.setFillColor(NSColor.white.cgColor)
            context.fill(paper)
            context.saveGState()
            context.clip(to: target)
            context.translateBy(x: target.minX - sourceX * scale, y: target.minY - sourceY * scale)
            context.scaleBy(x: scale, y: scale)
            context.drawPDFPage(page)
            context.restoreGState()
            context.endPDFPage()
        }

        context.closePDF()
        let destination = printDestination
        clearPrintState()
        let data = bytes as Data
        if let url = destination {
            do { try data.write(to: url, options: .atomic); notifySave(success: true, name: url.lastPathComponent) }
            catch { showError("No se pudo exportar el PDF. \(error.localizedDescription)") }
        } else {
            guard let document = PDFDocument(data: data) else { showError("No se pudo preparar la impresión."); return }
            let info = NSPrintInfo.shared.copy() as! NSPrintInfo
            info.paperSize = paper.size
            info.orientation = .portrait
            info.topMargin = 0; info.bottomMargin = 0; info.leftMargin = 0; info.rightMargin = 0
            guard let operation = document.printOperation(for: info, scalingMode: .pageScaleToFit, autoRotate: true) else { showError("No se pudo preparar la impresión."); return }
            operation.showsPrintPanel = true
            operation.showsProgressPanel = true
            operation.run()
        }
    }

    private func clearPrintState() {
        printWebView?.navigationDelegate = nil
        printWindow?.close()
        printWebView = nil
        printWindow = nil
        printDestination = nil
        printRects = []
        printData = nil
    }

    private func printFailed(_ message: String) {
        clearPrintState()
        showError("No se pudo preparar el PDF. \(message)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if webView === printWebView { clearPrintState() }
        showError("No se pudo cargar la interfaz. \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let scheme = navigationAction.request.url?.scheme, !["file", "about", "data"].contains(scheme) {
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message
        alert.addButton(withTitle: "Aceptar"); alert.addButton(withTitle: "Cancelar")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert(); alert.messageText = prompt
        let input = NSTextField(string: defaultText ?? ""); input.frame = NSRect(x: 0, y: 0, width: 320, height: 24)
        alert.accessoryView = input
        alert.addButton(withTitle: "Aceptar"); alert.addButton(withTitle: "Cancelar")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn ? input.stringValue : nil) }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if bypassClose { return true }
        guard !checkingClose else { return false }
        checkingClose = true
        evaluate("window.Partitura ? (typeof window.Partitura.hasUnsavedChanges==='function' ? window.Partitura.hasUnsavedChanges() : !!window.Partitura.hasUnsavedChanges) : false") { [weak self] value, error in
            guard let self = self else { return }
            guard error != nil || value as? Bool == true else { self.checkingClose = false; self.finishClose(); return }
            let alert = NSAlert()
            alert.messageText = "¿Guardar los cambios de la partitura?"
            alert.informativeText = "Puedes guardar el archivo antes de cerrar."
            alert.addButton(withTitle: "Guardar…")
            alert.addButton(withTitle: "Descartar")
            alert.addButton(withTitle: "Cancelar")
            alert.beginSheetModal(for: self.window) { response in
                self.checkingClose = false
                if response == .alertFirstButtonReturn {
                    self.closeAfterSave = true
                    self.evaluate("window.Partitura.save()") { _, error in
                        if let error = error { self.closeAfterSave = false; self.showError(error.localizedDescription) }
                    }
                } else if response == .alertSecondButtonReturn { self.finishClose() }
            }
        }
        return false
    }

    private func finishClose() { bypassClose = true; window.close() }
    func windowWillClose(_ notification: Notification) { audioExporter.cancel(); midiInput.stop(notify: false); playback.stop(); allowTermination = true; NSApp.terminate(nil) }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if allowTermination || window == nil { return .terminateNow }
        window.performClose(nil)
        return .terminateCancel
    }
    private func showError(_ message: String) {
        let alert = NSAlert(); alert.alertStyle = .warning; alert.messageText = "Rick Music"; alert.informativeText = message
        if let window = window, window.isVisible { alert.beginSheetModal(for: window, completionHandler: nil) }
        else { alert.runModal() }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
