package ai.hyperclaw

import android.Manifest
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.compose.ui.viewinterop.AndroidView
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject
import okhttp3.*
import java.util.UUID
import java.util.concurrent.TimeUnit

// ─── Theme ────────────────────────────────────────────────────────────────────

val CyanColor = Color(0xFF06B6D4)
val DarkBg = Color(0xFF0A0F1A)
val SurfaceColor = Color(0xFF111827)
val BorderColor = Color(0xFF1F2937)

// ─── Data ─────────────────────────────────────────────────────────────────────

data class ChatMessage(
    val id: Long = System.currentTimeMillis(),
    val role: Role,
    val content: String,
    val timestamp: Long = System.currentTimeMillis()
) {
    enum class Role { USER, ASSISTANT }
}

// ─── Gateway WebSocket ────────────────────────────────────────────────────────

class GatewayClient(
    private val gatewayUrl: String,
    private val token: String? = null,
    private val context: Context
) {
    var isConnected = false
        private set
    var onMessage: (String) -> Unit = {}
    var onNodeCommand: ((id: String, type: String, params: Map<String, Any?>?) -> Unit)? = null
    var onConnectionChange: ((Boolean) -> Unit)? = null
    var onConnectOk: ((sessionId: String) -> Unit)? = null
    var onSessionTranscript: ((transcript: org.json.JSONArray) -> Unit)? = null
    private var webSocket: WebSocket? = null
    private var reconnectAttempt = 0
    private var shouldReconnect = true
    private var heartbeatTask: Runnable? = null
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private val wsUrl get() = gatewayUrl.replace("http", "ws")

    fun connect() {
        shouldReconnect = true
        doConnect()
    }

    private fun doConnect() {
        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                isConnected = true
                reconnectAttempt = 0
                onConnectionChange?.invoke(true)
                // Node register for mobile node (agent can send device commands)
                val nodeId = "android-${Build.MODEL.replace(" ", "-")}-${UUID.randomUUID().toString().take(8)}"
                val caps = JSONObject().apply {
                    put("location", true)
                    put("notifications", true)
                    put("sms", true)
                    put("contacts", true)
                    put("calendar", true)
                    put("motion", true)
                }
                val reg = JSONObject().apply {
                    put("type", "node_register")
                    put("nodeId", nodeId)
                    put("platform", "android")
                    put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}")
                    put("capabilities", caps)
                    put("protocolVersion", 2)
                }
                if (!token.isNullOrBlank()) reg.put("token", token)
                webSocket.send(reg.toString())
                onMessage("")
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val obj = JSONObject(text)
                    when (obj.optString("type")) {
                        "connect.ok", "node:registered" -> {
                            val sid = obj.optString("sessionId")
                            if (sid.isNotBlank()) onConnectOk?.invoke(sid)
                            val interval = obj.optLong("heartbeatInterval", 30000)
                            if (interval > 0) startHeartbeat(interval)
                        }
                        "session:transcript" -> {
                            val arr = obj.optJSONArray("transcript")
                            if (arr != null) onSessionTranscript?.invoke(arr)
                        }
                        "chat:response" -> {
                            val content = obj.optString("content", text)
                            if (content.isNotBlank()) onMessage(content)
                        }
                        "node:command" -> {
                            val id = obj.optString("id")
                            val cmd = obj.optString("command")
                            val params = obj.optJSONObject("params")?.let { jo ->
                                jo.keys().asSequence().associateWith { jo.opt(it) }
                            }
                            onNodeCommand?.invoke(id, cmd, params)
                        }
                        "node:registered" -> {}
                        "node:error" -> onMessage("[Gateway: ${obj.optString("message", "auth error")}]")
                        else -> {
                            val content = obj.optString("content", text)
                            if (content.isNotBlank()) onMessage(content)
                            else onMessage(text)
                        }
                    }
                } catch (_: Exception) {
                    try {
                        val content = text.substringAfter("\"content\":\"").substringBefore("\"")
                            .replace("\\\"", "\"")
                        if (content.isNotBlank()) onMessage(content) else onMessage(text)
                    } catch (_: Exception) { onMessage(text) }
                }
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {}
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                isConnected = false
                onConnectionChange?.invoke(false)
                scheduleReconnect()
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                isConnected = false
                onConnectionChange?.invoke(false)
                scheduleReconnect()
            }
        })
    }

    private fun startHeartbeat(intervalMs: Long) {
        heartbeatTask?.let { android.os.Handler(Looper.getMainLooper()).removeCallbacks(it) }
        val handler = android.os.Handler(Looper.getMainLooper())
        heartbeatTask = object : Runnable {
            override fun run() {
                if (!isConnected || webSocket == null) return
                try {
                    webSocket?.send(JSONObject().apply { put("type", "ping") }.toString())
                } catch (_: Exception) {}
                handler.postDelayed(this, intervalMs)
            }
        }
        handler.postDelayed(heartbeatTask!!, intervalMs)
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        val delay = minOf(30000L, 1000L * (1 shl reconnectAttempt))
        reconnectAttempt++
        android.os.Handler(Looper.getMainLooper()).postDelayed({ doConnect() }, delay)
    }

    fun disconnect() {
        shouldReconnect = false
        heartbeatTask?.let { android.os.Handler(Looper.getMainLooper()).removeCallbacks(it) }
        heartbeatTask = null
        webSocket?.let { ws ->
            val unreg = JSONObject().apply { put("type", "node:unregister") }
            try { ws.send(unreg.toString()) } catch (_: Exception) {}
        }
        webSocket?.close(1000, "close")
        webSocket = null
        isConnected = false
        onConnectionChange?.invoke(false)
    }

    fun send(message: String) {
        val json = """{"type":"chat:message","content":"${message.replace("\"", "\\\"")}","source":"android"}"""
        webSocket?.send(json)
    }

    fun sendSessionRestore(previousSessionId: String) {
        val obj = JSONObject().apply {
            put("type", "session:restore")
            put("previousSessionId", previousSessionId)
        }
        webSocket?.send(obj.toString())
    }

    fun sendNodeResponse(cmdId: String, ok: Boolean, data: Any? = null, error: String? = null) {
        val obj = JSONObject().apply {
            put("type", "node:command_response")
            put("id", cmdId)
            put("ok", ok)
            if (data != null) put("data", data)
            if (error != null) put("error", error)
        }
        webSocket?.send(obj.toString())
    }
}

// ─── Device Commands ───────────────────────────────────────────────────────────

object DeviceCommands {
    fun showNotification(context: Context, title: String, body: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        val channel = android.app.NotificationChannel(
            "hyperclaw",
            "HyperClaw",
            android.app.NotificationManager.IMPORTANCE_DEFAULT
        )
        nm.createNotificationChannel(channel)
        val n = android.app.Notification.Builder(context, "hyperclaw")
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .build()
        nm.notify(1, n)
    }
}

// ─── Activity ─────────────────────────────────────────────────────────────────

class MainActivity : ComponentActivity() {
    private val requestPermissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ -> }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val perms = mutableListOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.SEND_SMS,
            Manifest.permission.READ_SMS,
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.READ_CALENDAR,
            Manifest.permission.BODY_SENSORS
        )
        if (android.os.Build.VERSION.SDK_INT >= 33) perms.add(Manifest.permission.POST_NOTIFICATIONS)
        requestPermissions.launch(perms.toTypedArray())
        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    background = DarkBg,
                    surface = SurfaceColor,
                    primary = CyanColor,
                    onBackground = Color.White,
                    onSurface = Color.White
                )
            ) {
                HyperClawApp()
            }
        }
    }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HyperClawApp() {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var selectedTab by remember { mutableIntStateOf(1) }
    val defaultUrl = "ws://10.0.2.2:18789"
    var gatewayUrl by remember { mutableStateOf(defaultUrl) }
    var gatewayToken by remember { mutableStateOf<String?>(null) }
    var prefsLoaded by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        gatewayUrl = AppPrefs.getGatewayUrl(ctx) ?: defaultUrl
        gatewayToken = AppPrefs.getGatewayToken(ctx)
        prefsLoaded = true
    }
    val gateway = remember(gatewayUrl, gatewayToken, prefsLoaded) {
        if (!prefsLoaded) null else GatewayClient(gatewayUrl, gatewayToken, ctx)
    }
    val messages = remember { mutableStateListOf<ChatMessage>() }
    LaunchedEffect(Unit) {
        AppPrefs.getMessages(ctx)?.let { json ->
            try {
                val arr = JSONArray(json)
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    messages.add(ChatMessage(
                        id = o.optLong("id", System.currentTimeMillis()),
                        role = if (o.optString("role") == "USER") ChatMessage.Role.USER else ChatMessage.Role.ASSISTANT,
                        content = o.optString("content", ""),
                        timestamp = o.optLong("timestamp", System.currentTimeMillis())
                    ))
                }
            } catch (_: Exception) {}
        }
        if (messages.isEmpty()) messages.add(ChatMessage(role = ChatMessage.Role.ASSISTANT, content = "Hey! I'm Hyper 🦅"))
    }

    val persistMessages = { msgs: List<ChatMessage> ->
        scope.launch {
            val arr = JSONArray()
            msgs.forEach { m ->
                arr.put(JSONObject().apply {
                    put("id", m.id)
                    put("role", m.role.name)
                    put("content", m.content)
                    put("timestamp", m.timestamp)
                })
            }
            AppPrefs.setMessages(ctx, arr.toString())
        }
    }

    LaunchedEffect(gateway) {
        if (gateway == null) return@LaunchedEffect
        val main = Handler(Looper.getMainLooper())
        gateway.onMessage = { text ->
            if (text.isNotEmpty()) {
                main.post {
                    messages.add(ChatMessage(role = ChatMessage.Role.ASSISTANT, content = text))
                    persistMessages(messages)
                }
            }
        }
        gateway.onConnectOk = { sessionId ->
            scope.launch {
                val prev = AppPrefs.getPreviousSessionId(ctx)
                if (!prev.isNullOrBlank()) gateway.sendSessionRestore(prev)
                AppPrefs.setPreviousSessionId(ctx, sessionId)
            }
        }
        gateway.onSessionTranscript = { arr ->
            main.post {
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    val role = if (o.optString("role") == "user") ChatMessage.Role.USER else ChatMessage.Role.ASSISTANT
                    val content = o.optString("content", "")
                    if (content.isNotBlank() && !messages.any { it.content == content && it.role == role }) {
                        messages.add(ChatMessage(role = role, content = content))
                    }
                }
                persistMessages(messages)
            }
        }
        gateway.onNodeCommand = { id, type, params ->
            scope.launch {
                when (type) {
                    "location" -> {
                        val result = getCurrentLocation(ctx)
                        gateway.sendNodeResponse(id, true, result)
                    }
                    "notify" -> {
                        val title = (params?.get("title") as? String) ?: "HyperClaw"
                        val body = (params?.get("body") as? String) ?: ""
                        DeviceCommands.showNotification(ctx, title, body)
                        gateway.sendNodeResponse(id, true, "ok")
                    }
                    "volume_up", "volume_down" -> {
                        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
                        val stream = android.media.AudioManager.STREAM_MUSIC
                        if (type == "volume_up") am.adjustStreamVolume(stream, android.media.AudioManager.ADJUST_RAISE, 0)
                        else am.adjustStreamVolume(stream, android.media.AudioManager.ADJUST_LOWER, 0)
                        val vol = am.getStreamVolume(stream)
                        val max = am.getStreamMaxVolume(stream)
                        gateway.sendNodeResponse(id, true, "Volume: $vol/$max")
                    }
                    "sms_send" -> {
                        val to = (params?.get("to") as? String) ?: (params?.get("number") as? String)
                        val body = (params?.get("body") as? String) ?: (params?.get("text") as? String) ?: ""
                        if (to.isNullOrBlank()) {
                            gateway.sendNodeResponse(id, false, null, "Missing 'to' or 'number'")
                        } else {
                            NodeCommands.smsSend(ctx, to, body).fold(
                                { gateway.sendNodeResponse(id, true, it) },
                                { gateway.sendNodeResponse(id, false, null, it.message) }
                            )
                        }
                    }
                    "contacts_list" -> {
                        val limit = (params?.get("limit") as? Number)?.toInt() ?: 50
                        NodeCommands.contactsList(ctx, limit).fold(
                            { gateway.sendNodeResponse(id, true, it) },
                            { gateway.sendNodeResponse(id, false, null, it.message) }
                        )
                    }
                    "calendar_events" -> {
                        val days = (params?.get("daysAhead") as? Number)?.toInt() ?: 7
                        NodeCommands.calendarEvents(ctx, days).fold(
                            { gateway.sendNodeResponse(id, true, it) },
                            { gateway.sendNodeResponse(id, false, null, it.message) }
                        )
                    }
                    "motion" -> {
                        NodeCommands.motionSample(ctx).fold(
                            { gateway.sendNodeResponse(id, true, it) },
                            { gateway.sendNodeResponse(id, false, null, it.message) }
                        )
                    }
                    else -> gateway.sendNodeResponse(id, false, null, "Command not implemented: $type")
                }
            }
        }
        gateway!!.connect()
    }

    DisposableEffect(gateway) {
        onDispose { gateway?.disconnect() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("🦅", fontSize = 20.sp)
                        Column {
                            Text("HyperClaw", fontWeight = FontWeight.Bold, color = CyanColor, fontSize = 16.sp)
                            Text("v4.0.1", fontSize = 11.sp, color = Color.Gray)
                        }
                    }
                },
                actions = {
                    Box(Modifier.size(8.dp).background(if (gateway?.isConnected == true) CyanColor else Color.Red, CircleShape))
                    Spacer(Modifier.width(16.dp))
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SurfaceColor)
            )
        },
        bottomBar = {
            Surface(color = SurfaceColor) {
                Row(
                    Modifier.fillMaxWidth().padding(8.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    listOf(
                        Triple(0, Icons.Default.Link, "Connect"),
                        Triple(1, Icons.Default.Chat, "Chat"),
                        Triple(2, Icons.Default.Mic, "Voice"),
                        Triple(3, Icons.Default.Apps, "Canvas")
                    ).forEach { (tab, icon, label) ->
                        Column(
                            modifier = Modifier.clickable { selectedTab = tab },
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Icon(icon, contentDescription = null, tint = if (selectedTab == tab) CyanColor else Color.Gray)
                            Text(label, fontSize = 12.sp, color = if (selectedTab == tab) CyanColor else Color.Gray)
                        }
                    }
                }
            }
        }
    ) { padding ->
        when {
            gateway == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = CyanColor)
            }
            selectedTab == 0 -> ConnectTab(gatewayUrl, gatewayToken, gateway!!, onUrlChange = { gatewayUrl = it }, onTokenChange = { gatewayToken = it }, ctx, scope, padding)
            selectedTab == 1 -> ChatTab(gateway!!, messages, persistMessages, padding)
            selectedTab == 2 -> VoiceTab(gateway!!, LocalContext.current, padding)
            else -> CanvasTab(gatewayUrl, gateway!!, padding)
        }
    }
}

@Composable
fun ConnectTab(
    gatewayUrl: String,
    gatewayToken: String?,
    gateway: GatewayClient,
    onUrlChange: (String) -> Unit,
    onTokenChange: (String?) -> Unit,
    context: Context,
    scope: kotlinx.coroutines.CoroutineScope,
    padding: PaddingValues
) {
    var url by remember(gatewayUrl) { mutableStateOf(gatewayUrl) }
    var token by remember(gatewayToken) { mutableStateOf(gatewayToken ?: "") }

    Column(Modifier.fillMaxSize().background(DarkBg).padding(padding).padding(16.dp)) {
        Text("Device pairing", fontWeight = FontWeight.Bold, color = CyanColor, fontSize = 18.sp)
        Spacer(Modifier.height(8.dp))
        Text("Gateway URL (use 10.0.2.2 for emulator)", color = Color.Gray, fontSize = 12.sp)
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("ws://10.0.2.2:18789") },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = CyanColor,
                unfocusedBorderColor = BorderColor,
                cursorColor = CyanColor
            )
        )
        Spacer(Modifier.height(12.dp))
        Text("Gateway token (optional, if gateway has auth)", color = Color.Gray, fontSize = 12.sp)
        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Leave empty if no auth") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = CyanColor,
                unfocusedBorderColor = BorderColor,
                cursorColor = CyanColor
            )
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                scope.launch {
                    AppPrefs.setGatewayUrl(context, url)
                    AppPrefs.setGatewayToken(context, token.ifBlank { null })
                }
                gateway.disconnect()
                onUrlChange(url)
                onTokenChange(token.ifBlank { null })
            },
            colors = ButtonDefaults.buttonColors(containerColor = CyanColor)
        ) { Text("Connect") }
        Spacer(Modifier.height(24.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).background(if (gateway.isConnected) CyanColor else Color.Red, CircleShape))
            Spacer(Modifier.width(8.dp))
            Text(if (gateway.isConnected) "Paired" else "Not paired", color = Color.Gray)
        }
        Spacer(Modifier.height(16.dp))
        OutlinedButton(
            onClick = {
                ConnectionService.start(context)
            },
            colors = ButtonDefaults.outlinedButtonColors(contentColor = CyanColor)
        ) { Text("Run in background (persistent node)") }
        OutlinedButton(
            onClick = { ConnectionService.stop(context) },
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.Gray)
        ) { Text("Stop background service") }
    }
}

@Composable
fun ChatTab(gateway: GatewayClient, messages: MutableList<ChatMessage>, onPersist: (List<ChatMessage>) -> Unit, padding: PaddingValues) {
    var inputText by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    Column(Modifier.fillMaxSize().background(DarkBg).padding(padding)) {
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(messages) { msg -> MessageBubble(msg) }
        }
        Surface(color = SurfaceColor, tonalElevation = 2.dp) {
            Row(
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.Bottom
            ) {
                OutlinedTextField(
                    value = inputText,
                    onValueChange = { inputText = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Message HyperClaw...", color = Color.Gray, fontSize = 14.sp) },
                    maxLines = 4,
                    shape = RoundedCornerShape(20.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = CyanColor,
                        unfocusedBorderColor = BorderColor,
                        cursorColor = CyanColor
                    )
                )
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = {
                        if (inputText.isBlank() || isLoading || !gateway.isConnected) return@IconButton
                        val text = inputText.trim()
                        inputText = ""
                        messages.add(ChatMessage(role = ChatMessage.Role.USER, content = text))
                        onPersist(messages)
                        gateway.send(text)
                    },
                    modifier = Modifier.size(44.dp).background(CyanColor, CircleShape)
                ) { Text("↑", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp) }
            }
        }
    }
}

@Composable
fun CanvasTab(gatewayUrl: String, gateway: GatewayClient, padding: PaddingValues) {
    val canvasUrl = gatewayUrl.replace("ws://", "http://").replace("wss://", "https://").trimEnd('/') + "/dashboard#canvas"
    Column(Modifier.fillMaxSize().background(DarkBg).padding(padding)) {
        if (gateway.isConnected) {
            AndroidView(
                factory = { ctx ->
                    WebView(ctx).apply {
                        webViewClient = WebViewClient()
                        settings.javaScriptEnabled = true
                        loadUrl(canvasUrl)
                    }
                },
                modifier = Modifier.fillMaxSize()
            )
        } else {
            Column(
                Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(Icons.Default.Apps, null, Modifier.size(48.dp), tint = CyanColor.copy(alpha = 0.6f))
                Spacer(Modifier.height(16.dp))
                Text("Canvas Surface", fontWeight = FontWeight.Bold, color = CyanColor)
                Spacer(Modifier.height(8.dp))
                Text("Connect to gateway first", color = Color.Gray, fontSize = 14.sp)
            }
        }
    }
}

@Composable
fun VoiceTab(gateway: GatewayClient, context: Context, padding: PaddingValues) {
    var isListening by remember { mutableStateOf(false) }
    val recognizer = remember { SpeechRecognizer.createSpeechRecognizer(context) }

    Column(
        modifier = Modifier.fillMaxSize().background(DarkBg).padding(padding),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            if (isListening) Icons.Default.Mic else Icons.Default.MicNone,
            contentDescription = null,
            modifier = Modifier.size(80.dp),
            tint = if (isListening) Color.Red else Color.Gray
        )
        Spacer(Modifier.height(16.dp))
        Text(
            if (isListening) "Listening..." else "Hold to talk",
            color = Color.Gray,
            fontSize = 16.sp
        )
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = {
                if (isListening) {
                    recognizer.stopListening()
                    isListening = false
                } else if (gateway.isConnected) {
                    val intent = android.content.Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        putExtra(RecognizerIntent.EXTRA_LANGUAGE, java.util.Locale.getDefault())
                    }
                    recognizer.setRecognitionListener(object : RecognitionListener {
                        override fun onReadyForSpeech(p: Bundle?) {}
                        override fun onBeginningOfSpeech() {}
                        override fun onRmsChanged(rmsdB: Float) {}
                        override fun onBufferReceived(buffer: ByteArray?) {}
                        override fun onEndOfSpeech() { isListening = false }
                        override fun onError(error: Int) { isListening = false }
                        override fun onResults(results: Bundle?) {
                            results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { text ->
                                if (text.isNotBlank()) gateway.send(text)
                            }
                        }
                        override fun onPartialResults(partialResults: Bundle?) {}
                        override fun onEvent(eventType: Int, params: Bundle?) {}
                    })
                    recognizer.startListening(intent)
                    isListening = true
                }
            },
            colors = ButtonDefaults.buttonColors(containerColor = if (isListening) Color.Red else CyanColor)
        ) { Text(if (isListening) "Stop" else "Start") }
        if (!gateway.isConnected) {
            Spacer(Modifier.height(8.dp))
            Text("Connect first", color = Color(0xFFFFA500), fontSize = 12.sp)
        }
    }
}

@Composable
fun MessageBubble(msg: ChatMessage) {
    val isUser = msg.role == ChatMessage.Role.USER
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom
    ) {
        if (!isUser) {
            Box(Modifier.size(32.dp).background(CyanColor.copy(alpha = 0.15f), CircleShape), contentAlignment = Alignment.Center) {
                Text("🦅", fontSize = 14.sp)
            }
            Spacer(Modifier.width(8.dp))
        }
        Box(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .background(
                    if (isUser) CyanColor else SurfaceColor,
                    RoundedCornerShape(18.dp, 18.dp, if (isUser) 4.dp else 18.dp, if (isUser) 18.dp else 4.dp)
                )
                .padding(horizontal = 14.dp, vertical = 10.dp)
        ) {
            Text(msg.content, color = if (isUser) Color.Black else Color.White, fontSize = 14.sp)
        }
        if (isUser) Spacer(Modifier.width(8.dp))
    }
}
