// CV-0 spike 1: a plain WKWebView host (the system WebKit the Tauri app uses on
// macOS) for unattended runs. The Tauri window can be kept off screen by the
// Mac's window management while nobody is at it, and WebKit draws no frames
// for a window that isn't on screen; this host floats a non-activating panel
// over every Space instead, and quits once the collector has the results.
//   swiftc -O scripts/spikes/chat/s1/wkhost.swift -o <scratch>/wkhost
//   <scratch>/wkhost "<harness url>" "<collector status url>" <engine> <libs,comma,separated>

import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 5 else {
  print("usage: wkhost <url> <statusUrl> <engine> <libs>")
  exit(2)
}
let url = URL(string: args[1])!
let statusUrl = URL(string: args[2])!
let engine = args[3]
let libs = args[4].split(separator: ",").map(String.init)

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let panel = NSPanel(
  contentRect: NSRect(x: 0, y: 0, width: 1280, height: 840),
  styleMask: [.titled, .nonactivatingPanel],
  backing: .buffered,
  defer: false
)
panel.title = "Moduo · CV-0 spike 1 (WKWebView, closes itself)"
panel.level = .floating
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
panel.hidesOnDeactivate = false
panel.isFloatingPanel = true
panel.center()

let config = WKWebViewConfiguration()
if ProcessInfo.processInfo.environment["S1_COLD"] == "1" {
  // Nothing cached (fonts, modules): every run is a first launch.
  config.websiteDataStore = .nonPersistent()
}
if #available(macOS 14.0, *) {
  // What Tauri's backgroundThrottling: "disabled" sets.
  config.preferences.inactiveSchedulingPolicy = .none
}
let web = WKWebView(frame: panel.contentView!.bounds, configuration: config)
web.autoresizingMask = [.width, .height]
panel.contentView!.addSubview(web)
panel.orderFrontRegardless()
web.load(URLRequest(url: url))
print("[wkhost] WebKit \(Bundle(for: WKWebView.self).infoDictionary?["CFBundleVersion"] ?? "?") loading \(url)")

// Keep the panel in front (another app's window can't push it off screen),
// and quit when the collector has every library's results.
let started = Date()
Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
  panel.orderFrontRegardless()
}
Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { _ in
  URLSession.shared.dataTask(with: statusUrl) { data, _, _ in
    guard let data,
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: [String]]
    else { return }
    let got = json[engine] ?? []
    if libs.allSatisfy({ got.contains($0) }) {
      print("[wkhost] all results in after \(Int(Date().timeIntervalSince(started))) s")
      exit(0)
    }
  }.resume()
  if Date().timeIntervalSince(started) > 40 * 60 {
    print("[wkhost] gave up after 40 min")
    exit(1)
  }
}
app.run()
