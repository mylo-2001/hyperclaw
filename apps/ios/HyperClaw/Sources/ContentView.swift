//
//  ContentView.swift
//  HyperClaw
//
//  ⚡ HyperClaw — AI Gateway Platform
//  Tabs: Connect (device pairing), Chat, Voice, Canvas
//

import SwiftUI
import Combine
import Network
import AVFoundation
import WebKit
#if canImport(Speech)
import Speech
#endif
import UIKit

// MARK: - Canvas WebView

struct SafariWebView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

// MARK: - Gateway Connection

class GatewayConnection: ObservableObject {
    @Published var connected = false
    @Published var messages: [ChatMessage] = []
    @Published var agentName: String
    @Published var gatewayURL: String
    @Published var gatewayToken: String
    @Published var sessionId: String?

    private var webSocketTask: URLSessionWebSocketTask?
    private var heartbeatTask: DispatchWorkItem?
    private var pendingAssistantId: UUID?

    struct ChatMessage: Identifiable {
        let id = UUID()
        let role: Role
        let content: String
        let timestamp = Date()
        enum Role { case user, assistant }
    }

    init() {
        let defaults = UserDefaults.standard
        self.agentName = defaults.string(forKey: "hyperclaw.agentName") ?? "Hyper"
        self.gatewayURL = defaults.string(forKey: "hyperclaw.gatewayURL") ?? "ws://localhost:18789"
        self.gatewayToken = defaults.string(forKey: "hyperclaw.gatewayToken") ?? ""
        self.sessionId = defaults.string(forKey: "hyperclaw.sessionId")
    }

    func connect(url: String) {
        save(url: url, token: gatewayToken, agentName: agentName)
        guard let wsURL = URL(string: url) else { return }
        let task = URLSession.shared.webSocketTask(with: wsURL)
        self.webSocketTask = task
        task.resume()
        receiveLoop()
    }

    func disconnect() {
        stopHeartbeat()
        sendJson([
            "type": "node:unregister"
        ])
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        connected = false
    }

    func send(_ text: String) {
        let msg = ChatMessage(role: .user, content: text)
        messages.append(msg)
        let payload = try? JSONSerialization.data(withJSONObject: [
            "type": "chat:message",
            "content": text,
            "source": "ios"
        ])
        if let payload {
            webSocketTask?.send(.data(payload)) { _ in }
        }
    }

    private func receiveLoop() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self.handleIncomingText(text)
                case .data(let data):
                    self.handleIncomingData(data)
                @unknown default:
                    break
                }
                self.receiveLoop()
            case .failure:
                DispatchQueue.main.async {
                    self.stopHeartbeat()
                    self.connected = false
                }
            }
        }
    }

    func updateSettings(url: String, token: String, agentName: String) {
        save(url: url, token: token, agentName: agentName)
    }

    private func save(url: String, token: String, agentName: String) {
        self.gatewayURL = url
        self.gatewayToken = token
        self.agentName = agentName
        let defaults = UserDefaults.standard
        defaults.set(url, forKey: "hyperclaw.gatewayURL")
        defaults.set(token, forKey: "hyperclaw.gatewayToken")
        defaults.set(agentName, forKey: "hyperclaw.agentName")
    }

    private func persistSessionId(_ value: String?) {
        sessionId = value
        let defaults = UserDefaults.standard
        if let value, !value.isEmpty {
            defaults.set(value, forKey: "hyperclaw.sessionId")
        } else {
            defaults.removeObject(forKey: "hyperclaw.sessionId")
        }
    }

    private func handleIncomingText(_ text: String) {
        guard let data = text.data(using: .utf8) else {
            appendAssistantMessage(text)
            return
        }
        handleIncomingData(data)
    }

    private func handleIncomingData(_ data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        handleIncomingJson(json)
    }

    private func handleIncomingJson(_ json: [String: Any]) {
        let type = json["type"] as? String ?? ""
        switch type {
        case "connect.challenge":
            guard !gatewayToken.isEmpty else { return }
            sendJson([
                "type": "auth",
                "token": gatewayToken
            ])
        case "connect.ok", "auth.ok":
            connected = true
            if let sessionId = json["sessionId"] as? String, !sessionId.isEmpty {
                persistSessionId(sessionId)
            }
            registerNode()
            maybeRestoreSession()
            startHeartbeat(intervalMs: (json["heartbeatInterval"] as? Double) ?? 30000)
        case "node:registered":
            connected = true
            if let sessionId = json["sessionId"] as? String, !sessionId.isEmpty {
                persistSessionId(sessionId)
            }
            startHeartbeat(intervalMs: (json["heartbeatInterval"] as? Double) ?? 30000)
        case "session:restored":
            if let transcript = json["transcript"] as? [[String: Any]] {
                mergeTranscript(transcript)
            }
        case "chat:response":
            if let content = json["content"] as? String, !content.isEmpty {
                appendAssistantMessage(content)
            }
        case "chat:chunk":
            if let content = json["content"] as? String, !content.isEmpty {
                appendAssistantChunk(content)
            }
        case "node:error", "error":
            if let message = json["message"] as? String, !message.isEmpty {
                appendAssistantMessage("[Gateway: \(message)]")
            }
        default:
            if let content = json["content"] as? String, !content.isEmpty {
                appendAssistantMessage(content)
            }
        }
    }

    private func registerNode() {
        let nodeName = UIDevice.current.name
        let nodeId = "ios-\(nodeName.replacingOccurrences(of: " ", with: "-"))"
        sendJson([
            "type": "node_register",
            "nodeId": nodeId,
            "platform": "ios",
            "deviceName": nodeName,
            "protocolVersion": 2,
            "token": gatewayToken,
            "capabilities": [
                "voice": true,
                "canvas": true,
                "camera": true,
                "screenRecord": true
            ]
        ])
    }

    private func maybeRestoreSession() {
        guard let sessionId, !sessionId.isEmpty else { return }
        sendJson([
            "type": "session:restore",
            "previousSessionId": sessionId
        ])
    }

    private func startHeartbeat(intervalMs: Double) {
        stopHeartbeat()
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.sendJson(["type": "ping"])
            self.startHeartbeat(intervalMs: intervalMs)
        }
        heartbeatTask = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (intervalMs / 1000.0), execute: work)
    }

    private func stopHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = nil
    }

    private func sendJson(_ object: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        webSocketTask?.send(.data(data)) { _ in }
    }

    private func mergeTranscript(_ transcript: [[String: Any]]) {
        let restored = transcript.compactMap { item -> ChatMessage? in
            guard let roleValue = item["role"] as? String,
                  let content = item["content"] as? String,
                  !content.isEmpty else { return nil }
            let role: ChatMessage.Role = roleValue == "user" ? .user : .assistant
            return ChatMessage(role: role, content: content)
        }
        guard !restored.isEmpty else { return }
        DispatchQueue.main.async {
            self.messages = restored
        }
    }

    private func appendAssistantMessage(_ content: String) {
        DispatchQueue.main.async {
            self.pendingAssistantId = nil
            self.messages.append(ChatMessage(role: .assistant, content: content))
        }
    }

    private func appendAssistantChunk(_ content: String) {
        DispatchQueue.main.async {
            if let lastId = self.pendingAssistantId,
               let index = self.messages.firstIndex(where: { $0.id == lastId }) {
                let existing = self.messages[index]
                self.messages[index] = ChatMessage(role: .assistant, content: existing.content + content)
            } else {
                let msg = ChatMessage(role: .assistant, content: content)
                self.pendingAssistantId = msg.id
                self.messages.append(msg)
            }
        }
    }
}

// MARK: - Gateway Discovery (device pairing)

class GatewayDiscovery: ObservableObject {
    @Published var discovered: [(name: String, url: String)] = []
    private var browser: NWBrowser?

    func startDiscovery() {
        let params = NWParameters()
        params.includePeerToPeer = true
        browser = NWBrowser(for: .bonjour(type: "_hyperclaw._tcp", domain: nil), using: params)
        browser?.stateUpdateHandler = { state in
            if case .failed(let error) = state { print("Discovery: \(error)") }
        }
        browser?.browseResultsChangedHandler = { [weak self] results, _ in
            var found: [(String, String)] = []
            for result in results {
                if case .service(let name, _, _, _) = result.endpoint {
                    found.append((name, "ws://\(name).local:18789"))
                }
            }
            DispatchQueue.main.async { self?.discovered = found }
        }
        browser?.start(queue: .main)
    }

    func stopDiscovery() {
        browser?.cancel()
        browser = nil
    }
}

// MARK: - Voice Wake (Speech recognition → gateway + wake word detection)

class VoiceWake: ObservableObject {
    @Published var isListening = false
    @Published var isWakeWordActive = false
    @Published var transcript = ""
    @Published var talkModeActive = false

    var wakeWord: String = "hey hyper"

    #if canImport(Speech)
    private var audioEngine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var resultCallback: ((String) -> Void)?
    private var wakeWordEngine: AVAudioEngine?
    private var wakeWordRequest: SFSpeechAudioBufferRecognitionRequest?
    private var wakeWordTask: SFSpeechRecognitionTask?
    #endif

    func requestPermission(completion: @escaping (Bool) -> Void) {
        #if canImport(Speech)
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else { completion(false); return }
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async { completion(granted) }
            }
        }
        #else
        completion(false)
        #endif
    }

    // ── Wake word always-on listener ──────────────────────────────────────────

    /// Starts a low-power continuous listener that fires `onWake` when the
    /// configured wake word is detected. Does not process full commands.
    func startWakeWordDetection(onWake: @escaping () -> Void) {
        #if canImport(Speech)
        guard !isWakeWordActive else { return }
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.isAvailable else { return }

        let engine = AVAudioEngine()
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = true   // on-device = lower latency, no network

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch { return }

        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            req.append(buffer)
        }
        engine.prepare()
        do { try engine.start() } catch { return }

        wakeWordEngine = engine
        wakeWordRequest = req
        isWakeWordActive = true

        wakeWordTask = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result = result {
                let text = result.bestTranscription.formattedString.lowercased()
                if text.contains(self.wakeWord) {
                    DispatchQueue.main.async {
                        self.stopWakeWordDetection()
                        onWake()
                        // Restart wake detection after 4 s (give time for full utterance)
                        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                            self.startWakeWordDetection(onWake: onWake)
                        }
                    }
                }
            }
            if error != nil, self.isWakeWordActive {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    self.startWakeWordDetection(onWake: onWake)
                }
            }
        }
        #endif
    }

    func stopWakeWordDetection() {
        #if canImport(Speech)
        wakeWordEngine?.stop()
        wakeWordEngine?.inputNode.removeTap(onBus: 0)
        wakeWordRequest?.endAudio()
        wakeWordTask?.cancel()
        wakeWordEngine = nil
        wakeWordRequest = nil
        wakeWordTask = nil
        #endif
        isWakeWordActive = false
    }

    // ── PTT / on-demand listening ─────────────────────────────────────────────

    func startListening(continuous: Bool = false, onResult: @escaping (String) -> Void) {
        #if canImport(Speech)
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.isAvailable else {
            onResult("Speech not available")
            return
        }
        resultCallback = onResult
        transcript = "Listening..."
        isListening = true

        let engine = AVAudioEngine()
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = false
        req.requiresOnDeviceRecognition = false

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            onResult("Audio session error")
            isListening = false
            return
        }

        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            req.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            onResult("Audio error: \(error.localizedDescription)")
            isListening = false
            return
        }

        self.audioEngine = engine
        self.request = req
        self.task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let result = result, result.isFinal {
                    let text = result.bestTranscription.formattedString
                    self.transcript = text
                    if !text.isEmpty { self.resultCallback?(text) }
                    self.stopListening()
                    if continuous {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                            self.startListening(continuous: true, onResult: self.resultCallback ?? { _ in })
                        }
                    }
                }
                if error != nil { self.stopListening() }
            }
        }
        #else
        onResult("Voice not available")
        #endif
    }

    func stopListening() {
        #if canImport(Speech)
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        audioEngine = nil
        request = nil
        task = nil
        #endif
        isListening = false
        transcript = ""
    }
}

// MARK: - Main Tabs

struct ContentView: View {
    @StateObject private var gateway = GatewayConnection()
    @StateObject private var discovery = GatewayDiscovery()
    @StateObject private var voice = VoiceWake()
    @State private var selectedTab = 1
    @State private var showSettings = false

    var body: some View {
        TabView(selection: $selectedTab) {
            ConnectTab(gateway: gateway, discovery: discovery)
                .tabItem { Label("Connect", systemImage: "antenna.radiowaves.left.and.right") }
                .tag(0)

            ChatTab(gateway: gateway)
                .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right.fill") }
                .tag(1)

            VoiceTab(gateway: gateway, voice: voice)
                .tabItem { Label("Voice", systemImage: "mic.fill") }
                .tag(2)

            CanvasTab(gateway: gateway)
                .tabItem { Label("Canvas", systemImage: "square.grid.3x3.fill") }
                .tag(3)
        }
        .preferredColorScheme(.dark)
        .navigationTitle("🦅 HyperClaw")
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showSettings = true } label: { Image(systemName: "gear") }
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView(gateway: gateway) }
        .onAppear {
            discovery.startDiscovery()
            if gateway.gatewayURL.contains("localhost") || gateway.gatewayURL.contains("127.0.0.1") {
                // On device, try discovered gateways first
                if let first = discovery.discovered.first {
                    gateway.connect(url: first.url)
                } else {
                    gateway.connect(url: gateway.gatewayURL)
                }
            } else {
                gateway.connect(url: gateway.gatewayURL)
            }
        }
    }
}

// MARK: - Connect Tab (device pairing)

struct ConnectTab: View {
    @ObservedObject var gateway: GatewayConnection
    @ObservedObject var discovery: GatewayDiscovery

    var body: some View {
        NavigationStack {
            List {
                Section("Status") {
                    HStack {
                        Circle().fill(gateway.connected ? Color.cyan : Color.red).frame(width: 10, height: 10)
                        Text(gateway.connected ? "Paired" : "Not paired")
                            .foregroundColor(.secondary)
                    }
                }
                Section("Discover Gateways") {
                    if discovery.discovered.isEmpty {
                        Text("Scanning for HyperClaw gateways on local network...")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    ForEach(discovery.discovered, id: \.name) { item in
                        Button {
                            gateway.disconnect()
                            gateway.connect(url: item.url)
                        } label: {
                            HStack {
                                Image(systemName: "desktopcomputer")
                                VStack(alignment: .leading) {
                                    Text(item.name).font(.headline)
                                    Text(item.url).font(.caption).foregroundColor(.secondary)
                                }
                                if gateway.gatewayURL == item.url && gateway.connected {
                                    Image(systemName: "checkmark.circle.fill").foregroundColor(.cyan)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Connect")
        }
    }
}

// MARK: - Chat Tab

struct ChatTab: View {
    @ObservedObject var gateway: GatewayConnection
    @State private var inputText = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Circle().fill(gateway.connected ? Color.cyan : Color.red).frame(width: 8, height: 8)
                    Text(gateway.connected ? "Connected" : "Disconnected").font(.caption).foregroundColor(.secondary)
                    Spacer()
                }
                .padding(.horizontal).padding(.vertical, 8).background(.ultraThinMaterial)

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(gateway.messages) { msg in
                                MessageBubble(message: msg).id(msg.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: gateway.messages.count) { _, _ in
                        if let last = gateway.messages.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }

                Divider()
                HStack(spacing: 12) {
                    TextField("Message...", text: $inputText, axis: .vertical)
                        .textFieldStyle(.plain).lineLimit(1...4)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(Color(.systemGray6))
                        .clipShape(RoundedRectangle(cornerRadius: 22))
                    Button {
                        guard !inputText.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                        gateway.send(inputText)
                        inputText = ""
                    } label: {
                        Image(systemName: "arrow.up.circle.fill").font(.title2).foregroundColor(.cyan)
                    }
                }
                .padding(.horizontal).padding(.vertical, 10).background(.ultraThinMaterial)
            }
            .navigationTitle("Chat")
        }
    }
}

// MARK: - Voice Tab (Voice Wake / Wake Word / PTT / Talk Mode)

struct VoiceTab: View {
    @ObservedObject var gateway: GatewayConnection
    @ObservedObject var voice: VoiceWake
    @State private var voiceResult = ""
    @State private var continuousMode = false
    @State private var wakeWordEnabled = false
    @State private var showTalkModeOverlay = false
    @State private var wakeWordInput = ""
    @State private var permissionGranted = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {

                    // ── Status bar ──
                    HStack(spacing: 16) {
                        wakeWordPill
                        listeningPill
                    }
                    .padding(.top, 8)

                    // ── Mic button ──
                    micButton

                    // ── Continuous toggle ──
                    Toggle("Always-on (continuous)", isOn: $continuousMode)
                        .toggleStyle(.switch).tint(.cyan)

                    Divider().padding(.horizontal)

                    // ── Wake Word section ──
                    wakeWordSection

                    // ── Last transcript ──
                    if !voiceResult.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Last utterance").font(.caption).foregroundColor(.secondary)
                            Text(voiceResult)
                                .font(.body)
                                .padding(10)
                                .background(Color(.systemGray6))
                                .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                        .padding(.horizontal)
                    }

                    if !gateway.connected {
                        Text("Connect to gateway first").font(.caption).foregroundColor(.orange)
                    }
                }
                .padding()
            }
            .navigationTitle("Voice")
        }
        // ── Talk Mode full-screen overlay ──
        .fullScreenCover(isPresented: $showTalkModeOverlay) {
            TalkModeOverlay(gateway: gateway, voice: voice, isPresented: $showTalkModeOverlay)
        }
        .onAppear {
            voice.requestPermission { granted in permissionGranted = granted }
        }
    }

    // ── Sub-views ─────────────────────────────────────────────────────────────

    private var wakeWordPill: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(voice.isWakeWordActive ? Color.green : Color.gray.opacity(0.4))
                .frame(width: 8, height: 8)
            Text(voice.isWakeWordActive ? "Wake word on" : "Wake word off")
                .font(.caption2).foregroundColor(.secondary)
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(Color(.systemGray6))
        .clipShape(Capsule())
    }

    private var listeningPill: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(voice.isListening ? Color.red : Color.gray.opacity(0.4))
                .frame(width: 8, height: 8)
            Text(voice.isListening ? "Listening..." : "Idle")
                .font(.caption2).foregroundColor(.secondary)
        }
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(Color(.systemGray6))
        .clipShape(Capsule())
    }

    private var micButton: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(voice.isListening ? Color.red.opacity(0.15) : Color.cyan.opacity(0.10))
                    .frame(width: 120, height: 120)
                    .scaleEffect(voice.isListening ? 1.12 : 1.0)
                    .animation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: voice.isListening)

                Image(systemName: voice.isListening ? "mic.fill" : "mic")
                    .font(.system(size: 48))
                    .foregroundColor(voice.isListening ? .red : .cyan)
            }
            .onTapGesture {
                guard permissionGranted && gateway.connected else { return }
                if voice.isListening {
                    voice.stopListening()
                } else {
                    voice.startListening(continuous: continuousMode) { text in
                        voiceResult = text
                        if !text.isEmpty { gateway.send(text) }
                    }
                }
            }

            Text(voice.isListening ? "Tap to stop" : "Tap to speak")
                .font(.subheadline).foregroundColor(.secondary)

            // Talk Mode button
            Button {
                showTalkModeOverlay = true
            } label: {
                Label("Talk Mode", systemImage: "waveform")
                    .font(.footnote).foregroundColor(.white)
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Color.purple)
                    .clipShape(Capsule())
            }
            .disabled(!gateway.connected)
        }
    }

    private var wakeWordSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Wake Word Detection")
                .font(.headline)

            Text("Continuously listens for your wake word, then sends the next utterance as a message.")
                .font(.caption).foregroundColor(.secondary)

            HStack {
                TextField("Wake word", text: $wakeWordInput)
                    .textFieldStyle(.roundedBorder)
                    .onAppear { wakeWordInput = voice.wakeWord }
                    .onChange(of: wakeWordInput) { _, v in
                        voice.wakeWord = v.lowercased().trimmingCharacters(in: .whitespaces)
                    }

                Toggle("", isOn: $wakeWordEnabled)
                    .toggleStyle(.switch).tint(.cyan)
                    .onChange(of: wakeWordEnabled) { _, enabled in
                        if enabled {
                            guard permissionGranted else { wakeWordEnabled = false; return }
                            voice.startWakeWordDetection {
                                // Wake word detected → open Talk Mode overlay
                                showTalkModeOverlay = true
                            }
                        } else {
                            voice.stopWakeWordDetection()
                        }
                    }
            }
            .disabled(!permissionGranted)

            if !permissionGranted {
                Text("Microphone & Speech permission required").font(.caption).foregroundColor(.orange)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal)
    }
}

// MARK: - Talk Mode Overlay (full-screen continuous voice)

struct TalkModeOverlay: View {
    @ObservedObject var gateway: GatewayConnection
    @ObservedObject var voice: VoiceWake
    @Binding var isPresented: Bool
    @State private var lastText = ""
    @State private var isActive = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 32) {
                HStack {
                    Spacer()
                    Button { stopAndClose() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title).foregroundColor(.gray)
                    }
                }
                .padding()

                Spacer()

                // Animated waveform indicator
                HStack(spacing: 6) {
                    ForEach(0..<7, id: \.self) { i in
                        RoundedRectangle(cornerRadius: 3)
                            .fill(isActive ? Color.cyan : Color.gray.opacity(0.3))
                            .frame(width: 6, height: isActive ? CGFloat.random(in: 20...60) : 20)
                            .animation(.easeInOut(duration: 0.3 + Double(i) * 0.05).repeatForever(autoreverses: true), value: isActive)
                    }
                }
                .frame(height: 70)

                Text(isActive ? "Listening..." : "Tap to start")
                    .font(.title2).foregroundColor(.white)

                if !lastText.isEmpty {
                    Text(lastText)
                        .font(.body).foregroundColor(.gray)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                Spacer()

                Button {
                    if isActive {
                        voice.stopListening()
                        isActive = false
                    } else {
                        startListening()
                    }
                } label: {
                    Circle()
                        .fill(isActive ? Color.red : Color.cyan)
                        .frame(width: 80, height: 80)
                        .overlay(
                            Image(systemName: isActive ? "stop.fill" : "mic.fill")
                                .font(.title).foregroundColor(.white)
                        )
                }
                .padding(.bottom, 48)
            }
        }
        .onAppear { startListening() }
        .onDisappear { voice.stopListening() }
    }

    private func startListening() {
        isActive = true
        voice.startListening(continuous: true) { text in
            lastText = text
            if !text.isEmpty { gateway.send(text) }
        }
    }

    private func stopAndClose() {
        voice.stopListening()
        isActive = false
        isPresented = false
    }
}

// MARK: - Canvas Tab (WebView for canvas surface)

struct CanvasTab: View {
    @ObservedObject var gateway: GatewayConnection

    private var canvasURL: URL? {
        let base = gateway.gatewayURL.replacingOccurrences(of: "ws://", with: "http://").replacingOccurrences(of: "wss://", with: "https://")
        return URL(string: "\(base)/dashboard#canvas")
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if let url = canvasURL, gateway.connected {
                    SafariWebView(url: url)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    Image(systemName: "square.grid.3x3.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.cyan.opacity(0.6))
                    Text("Canvas Surface")
                        .font(.title2)
                    Text("AI-generated UI components from your agent. Connect to gateway first.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle("Canvas")
        }
    }
}

// MARK: - Message Bubble

struct MessageBubble: View {
    let message: GatewayConnection.ChatMessage
    var isUser: Bool { message.role == .user }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isUser { Spacer(minLength: 60) }
            if !isUser {
                Text("🦅").font(.title3)
                    .frame(width: 32, height: 32)
                    .background(Color.cyan.opacity(0.15))
                    .clipShape(Circle())
            }
            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .font(.body)
                    .foregroundColor(isUser ? .black : .primary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(isUser ? Color.cyan : Color(.systemGray5))
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                Text(message.timestamp, style: .time)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
            if !isUser { Spacer(minLength: 60) }
        }
    }
}

// MARK: - Settings

struct SettingsView: View {
    @ObservedObject var gateway: GatewayConnection
    @Environment(\.dismiss) var dismiss
    @State private var url = ""
    @State private var token = ""
    @State private var agentName = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Gateway") {
                    LabeledContent("URL") {
                        TextField("ws://localhost:18789", text: $url)
                            .multilineTextAlignment(.trailing)
                            .keyboardType(.URL)
                    }
                    LabeledContent("Token") {
                        SecureField("Optional", text: $token)
                            .multilineTextAlignment(.trailing)
                    }
                    Button("Reconnect") {
                        gateway.updateSettings(
                            url: url.isEmpty ? gateway.gatewayURL : url,
                            token: token,
                            agentName: agentName.isEmpty ? gateway.agentName : agentName
                        )
                        gateway.disconnect()
                        gateway.connect(url: url.isEmpty ? gateway.gatewayURL : url)
                        dismiss()
                    }
                    .foregroundColor(.cyan)
                }
                Section("Agent") {
                    LabeledContent("Name") {
                        TextField("Hyper", text: $agentName)
                            .multilineTextAlignment(.trailing)
                    }
                }
                Section {
                    HStack {
                        Text("Status")
                        Spacer()
                        Circle().fill(gateway.connected ? Color.cyan : Color.red).frame(width: 8, height: 8)
                        Text(gateway.connected ? "Connected" : "Disconnected").foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                url = gateway.gatewayURL
                token = gateway.gatewayToken
                agentName = gateway.agentName
            }
        }
    }
}

#Preview {
    ContentView()
}
