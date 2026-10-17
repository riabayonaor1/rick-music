import AppKit
import WebKit

final class NativeEditorTests: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    private var view: WKWebView!
    private var holder: NSWindow!
    private var started = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        if ProcessInfo.processInfo.environment["RICK_BROWSER_MODE"] == nil { configuration.userContentController.add(self, name: "native") }
        configuration.userContentController.addUserScript(WKUserScript(source: "window.__nativeMessages=[];window.__editorErrors=[];window.addEventListener('error',e=>__editorErrors.push(e.message));window.addEventListener('unhandledrejection',e=>__editorErrors.push(String(e.reason)));const oldConsoleError=console.error;console.error=(...a)=>{__editorErrors.push(a.map(String).join(' '));oldConsoleError.apply(console,a);};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let genuine = URL(fileURLWithPath: "/Library/Application Support/MakeMusic/Finale 27/Plugin Components/Latin Percussion/Cha-Cha-Cha (Maestro Font).musx")
        if let bytes = try? Data(contentsOf: genuine) { configuration.userContentController.addUserScript(WKUserScript(source: "window.__genuineMusx='\(bytes.base64EncodedString())';", injectionTime: .atDocumentStart, forMainFrameOnly: true)) }
        if let demo = try? String(contentsOfFile: CommandLine.arguments[1].replacingOccurrences(of: "/dist/index.html", with: "/Ejemplos/Rick-Music-demo.rickmusic"), encoding: .utf8) { configuration.userContentController.addUserScript(WKUserScript(source: "window.__demoScore=\(demo);", injectionTime: .atDocumentStart, forMainFrameOnly: true)) }
        view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1500, height: 1050), configuration: configuration)
        view.navigationDelegate = self
        holder = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        holder.contentView = view
        holder.setFrameOrigin(NSPoint(x: -12000, y: -12000))
        holder.orderBack(nil)
        let index = URL(fileURLWithPath: CommandLine.arguments[1])
        view.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { self.fail("Native editor test timed out after 25 seconds") }
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let body = message.body as? [String: Any] else { fail("Invalid native bridge message"); return }
        do {
            let data = try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
            let json = String(data: data, encoding: .utf8)!
            view.evaluateJavaScript("window.__nativeMessages.push(\(json))") { _, error in
                if let error = error { self.fail(error.localizedDescription) }
            }
        } catch { fail(error.localizedDescription) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !started else { return }
        started = true
        Task { @MainActor in
            do {
                let scenario = try String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
                let wrapped = "try {\n" + scenario + "\n} catch(error) { return {passed:false,error:String(error),errors:window.__editorErrors}; }"
                guard let result = try await webView.callAsyncJavaScript(wrapped, arguments: [:], in: nil, contentWorld: .page) as? [String: Any] else { fail("Scenario returned no results"); return }
                let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
                if CommandLine.arguments.count > 3 {
                    let preview: NSImage = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<NSImage, Error>) in
                        webView.takeSnapshot(with: nil) { image, error in
                            if let image = image { continuation.resume(returning: image) }
                            else { continuation.resume(throwing: error ?? NSError(domain: "Preview", code: 1)) }
                        }
                    }
                    if let tiff = preview.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) { try png.write(to: URL(fileURLWithPath: CommandLine.arguments[3])) }
                }
                print(String(data: data, encoding: .utf8)!)
                exit(result["passed"] as? Bool == true ? 0 : 1)
            } catch { fail(error.localizedDescription) }
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    private func fail(_ message: String) { fputs("Native editor tests failed: \(message)\n", stderr); exit(1) }
}

guard CommandLine.arguments.count >= 3 else { fputs("Usage: native-editor-tests INDEX_HTML SCENARIO_JS\n", stderr); exit(2) }
let app = NSApplication.shared
let runner = NativeEditorTests()
app.delegate = runner
app.setActivationPolicy(.prohibited)
app.run()
