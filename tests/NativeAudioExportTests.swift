import Foundation
import AVFoundation
import AudioToolbox
import Darwin

// The runner prepends the real NativeAudioExporter class from production.
var exporter: NativeAudioExporter!
var begins: [String: [String: Any]] = [:]
var ended = Set<String>()
var errors: [String: String] = [:]
var frames: [String: Int] = [:]
var chunks: [String: Int] = [:]
var largest: [String: Int] = [:]
var leftPeak: [String: Int] = [:]
var rightPeak: [String: Int] = [:]
var progress: [String: [Double]] = [:]
var malformed = false
var assertions: [[String: Any]] = []
func check(_ condition: Bool, _ name: String) { assertions.append(["name": name, "passed": condition]) }
func peak(_ data: Data) -> Int {
    let bytes = [UInt8](data)
    var result = 0
    for i in stride(from: 0, to: bytes.count - 1, by: 2) {
        let word = UInt16(bytes[i]) | UInt16(bytes[i + 1]) << 8
        result = max(result, abs(Int(Int16(bitPattern: word))))
    }
    return result
}
exporter = NativeAudioExporter { name, data, complete in
    let id = data["jobId"] as? String ?? ""
    switch name {
    case "audioExportBegin": begins[id] = data
    case "audioExportChunk":
        guard let left = data["left"] as? String, let right = data["right"] as? String,
              let l = Data(base64Encoded: left), let r = Data(base64Encoded: right), l.count == r.count, l.count % 2 == 0 else {
            malformed = true; complete(NSError(domain: "Test", code: 1)); return
        }
        let count = l.count / 2
        frames[id, default: 0] += count
        chunks[id, default: 0] += 1
        largest[id] = max(largest[id] ?? 0, count)
        leftPeak[id] = max(leftPeak[id] ?? 0, peak(l))
        rightPeak[id] = max(rightPeak[id] ?? 0, peak(r))
        progress[id, default: []].append(data["progress"] as? Double ?? -1)
        if id == "cancel" { exporter.cancel(id) }
    case "audioExportEnd": ended.insert(id)
    case "audioExportError": errors[id] = data["message"] as? String ?? "Error desconocido"
    default: malformed = true
    }
    complete(nil)
}
func awaitJob(_ id: String) {
    let limit = Date().addingTimeInterval(30)
    while !ended.contains(id), errors[id] == nil, Date() < limit {
        _ = RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.02))
    }
}
func startRequest(_ body: [String: Any]) {
    // Match WKScriptMessage's Foundation/JSON number bridge at the API boundary.
    let bytes = try! JSONSerialization.data(withJSONObject: body)
    exporter.start(try! JSONSerialization.jsonObject(with: bytes) as! [String: Any])
}
// Optional CLI integration mode writes bounded PCM streams for MP3 verification.
func renderCLI(planPath: String, prefix: String) throws {
    var plan = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: planPath))) as! [String: Any]
    plan["jobId"] = "cli-render"
    let leftURL = URL(fileURLWithPath: prefix + "-left.pcm")
    let rightURL = URL(fileURLWithPath: prefix + "-right.pcm")
    guard FileManager.default.createFile(atPath: leftURL.path, contents: nil), FileManager.default.createFile(atPath: rightURL.path, contents: nil) else { throw NSError(domain: "RickMusic.AudioExportCLI", code: 1) }
    let leftFile = try FileHandle(forWritingTo: leftURL), rightFile = try FileHandle(forWritingTo: rightURL)
    defer { try? leftFile.close(); try? rightFile.close() }
    var finished = false, problem: String?
    var metadata: [String: Any] = [:]
    var frameCount = 0, chunkCount = 0
    let writer = NativeAudioExporter { name, data, complete in
        do {
            switch name {
            case "audioExportBegin": metadata = data
            case "audioExportChunk":
                guard let l = data["left"] as? String, let r = data["right"] as? String,
                      let left = Data(base64Encoded: l), let right = Data(base64Encoded: r), left.count == right.count, left.count % 2 == 0 else { throw NSError(domain: "RickMusic.AudioExportCLI", code: 2) }
                try leftFile.write(contentsOf: left); try rightFile.write(contentsOf: right)
                frameCount += left.count / 2; chunkCount += 1
            case "audioExportEnd": finished = true
            case "audioExportError": problem = data["message"] as? String ?? "Error de audio"; finished = true
            default: break
            }
            complete(nil)
        } catch { problem = error.localizedDescription; complete(error); finished = true }
    }
    writer.start(plan)
    let timeout = Date().addingTimeInterval(120)
    while !finished, Date() < timeout { _ = RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.02)) }
    if !finished { writer.cancel(); throw NSError(domain: "RickMusic.AudioExportCLI", code: 3, userInfo: [NSLocalizedDescriptionKey: "Tiempo agotado al renderizar PCM."]) }
    if let problem = problem { throw NSError(domain: "RickMusic.AudioExportCLI", code: 4, userInfo: [NSLocalizedDescriptionKey: problem]) }
    metadata["passed"] = true; metadata["renderedFrames"] = frameCount; metadata["chunks"] = chunkCount
    metadata["leftFile"] = leftURL.path; metadata["rightFile"] = rightURL.path
    let bytes = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
    print(String(data: bytes, encoding: .utf8)!)
}
if CommandLine.arguments.count == 3 {
    do { try renderCLI(planPath: CommandLine.arguments[1], prefix: CommandLine.arguments[2]); exit(0) }
    catch { fputs(error.localizedDescription + "\n", stderr); exit(1) }
}
let notes: [[String: Any]] = [
    ["pitch": 60, "at": 0.0, "duration": 0.4, "velocity": 100],
    ["pitch": 60, "at": 0.1, "duration": 0.1, "velocity": 80]
]
startRequest(["jobId": "music", "duration": 0.5, "parts": [
    ["program": 0, "volume": 0.8, "notes": notes],
    ["program": 53, "volume": 0.6, "notes": [["pitch": 48, "at": 0.1, "duration": 0.3, "velocity": 90]]],
    ["program": 0, "percussion": true, "volume": 0.5, "notes": [["pitch": 36, "at": 0.0, "duration": 0.1, "velocity": 100]]]
]])
awaitJob("music")
check(ended.contains("music") && errors["music"] == nil, "Render DLS de piano, voz y batería finaliza sin errores")
check(begins["music"]?["sampleRate"] as? Int == 44100 && begins["music"]?["channels"] as? Int == 2, "Formato estéreo de 44.100 Hz")
check((begins["music"]?["frames"] as? Int64) == 110250 && frames["music"] == 110250, "Duración determinista: 0,5 s de música más 2 s de cola")
check(chunks["music"] == 4 && largest["music"] == 32768 && !malformed, "PCM Int16LE válido en cuatro bloques de hasta 32.768 frames")
check((leftPeak["music"] ?? 0) > 0 && (rightPeak["music"] ?? 0) > 0, "Ambos canales contienen señal de audio real")
let advances = progress["music"] ?? []
check(advances == advances.sorted() && advances.last == 1, "Progreso monótono hasta 100 %")
startRequest(["jobId": "muted", "duration": 0.2, "parts": [["program": 0, "muted": true, "notes": notes]]])
awaitJob("muted")
check(ended.contains("muted") && leftPeak["muted"] == 0 && rightPeak["muted"] == 0, "Los pentagramas silenciados no producen señal")
startRequest(["jobId": "cancel", "duration": 60.0, "parts": [["program": 19, "notes": [["pitch": 60, "at": 0.0, "duration": 10.0, "velocity": 100]]]]])
awaitJob("cancel")
check(errors["cancel"]?.contains("cancelada") == true && !ended.contains("cancel") && chunks["cancel"] == 1, "Cancelación tras el primer bloque impide generar el resto")
startRequest(["jobId": "too-long", "duration": 1801.0, "parts": [["program": 0, "notes": []]]])
awaitJob("too-long")
check(errors["too-long"]?.contains("30 minutos") == true && begins["too-long"] == nil, "Se rechazan partituras de más de 30 minutos antes de renderizar")
let passed = assertions.allSatisfy { $0["passed"] as? Bool == true }
let result: [String: Any] = ["passed": passed, "assertionCount": assertions.count, "assertions": assertions, "frames": frames, "chunks": chunks, "leftPeak": leftPeak, "rightPeak": rightPeak, "errors": errors]
let output = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
print(String(data: output, encoding: .utf8)!)
exit(passed ? 0 : 1)
