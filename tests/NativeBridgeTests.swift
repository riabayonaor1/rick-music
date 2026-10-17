import AppKit
import WebKit
import Darwin

// The runner prepends the actual command helper extracted from production.
final class BridgeTests: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var webView: WKWebView!
    private var assertions: [String] = []
    func applicationDidFinishLaunching(_ notification: Notification) {
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 500, height: 300))
        webView.navigationDelegate = self
        webView.loadHTMLString("<html><body>Bridge test</body></html>", baseURL: nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { self.finish(error: "Tiempo de espera agotado.") }
    }
    @MainActor private func evaluate(_ script: String, expectsResult: Bool) async throws -> Any? {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any?, Error>) in
            webView.evaluateJavaScript(nativeJavaScriptCommand(script, expectsResult: expectsResult)) { value, error in
                if let error = error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value) }
            }
        }
    }
    private func check(_ value: Bool, _ label: String) throws {
        guard value else { throw NSError(domain: "RickMusic.BridgeTests", code: 1, userInfo: [NSLocalizedDescriptionKey: label]) }
        assertions.append(label)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            do {
                var rawUnsupported = false
                do { _ = try await evaluate("Promise.resolve(7)", expectsResult: true) }
                catch { let e = error as NSError; rawUnsupported = e.domain == WKErrorDomain && e.code == WKError.javaScriptResultTypeIsUnsupported.rawValue }
                try check(rawUnsupported, "Promise sin envoltura reproduce WKError de tipo no compatible")
                let ignored = try await evaluate("Promise.resolve(7)", expectsResult: false)
                try check(ignored == nil || ignored is NSNull, "Comando Promise sin completion devuelve null sin error")
                _ = try await evaluate("window.Partitura={openFile:async()=>{window.opened=true;return 'done'},exportMUSX:async()=>new Uint8Array([1,2]),printHTML:()=>'<html><body>Partitura</body></html>',hasUnsavedChanges:()=>true};window.Partitura.openFile()", expectsResult: false)
                try check(try await evaluate("window.opened===true", expectsResult: true) as? Bool == true, "Abrir async ejecuta sus efectos sin error de puente")
                let exported = try await evaluate("window.Partitura.exportMUSX()", expectsResult: false)
                try check(exported == nil || exported is NSNull, "Exportar MUSX async ignora el resultado no puenteable")
                let html = try await evaluate("window.Partitura.printHTML()", expectsResult: true)
                try check(html as? String == "<html><body>Partitura</body></html>", "Completion de impresión conserva el HTML")
                let unsaved = try await evaluate("window.Partitura.hasUnsavedChanges()", expectsResult: true)
                try check(unsaved as? Bool == true, "Completion de cierre conserva el booleano")
                var throwsSynchronously = false
                do { _ = try await evaluate("throw new Error('test')", expectsResult: false) } catch { throwsSynchronously = true }
                try check(throwsSynchronously, "Los errores síncronos reales siguen propagándose")
                finish(error: nil)
            } catch { finish(error: error.localizedDescription) }
        }
    }
    private func finish(error: String?) {
        var result: [String: Any] = ["passed": error == nil, "assertionCount": assertions.count, "assertions": assertions]
        if let error = error { result["error"] = error }
        let data = try! JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        print(String(data: data, encoding: .utf8)!)
        exit(error == nil ? 0 : 1)
    }
}
let app = NSApplication.shared
let delegate = BridgeTests()
app.delegate = delegate
app.setActivationPolicy(.prohibited)
app.run()
