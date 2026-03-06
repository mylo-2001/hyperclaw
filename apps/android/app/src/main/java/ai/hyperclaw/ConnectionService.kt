package ai.hyperclaw

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Foreground service for persistent node mode.
 * Keeps WebSocket connection alive when app is in background.
 */
class ConnectionService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var gateway: GatewayClient? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startConnection()
            ACTION_STOP -> stopSelf()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        gateway?.disconnect()
        gateway = null
        scope.cancel()
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "HyperClaw Connection",
                NotificationManager.IMPORTANCE_LOW
            ).apply { setShowBadge(false) }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(ch)
        }
    }

    private fun startConnection() {
        scope.launch {
            val url = AppPrefs.getGatewayUrl(this@ConnectionService) ?: "ws://10.0.2.2:18789"
            val token = AppPrefs.getGatewayToken(this@ConnectionService)
            val client = GatewayClient(url, token, this@ConnectionService)
            client.onConnectionChange = { connected ->
                updateNotification(connected)
            }
            gateway = client
            client.connect()
            startForeground(NOTIFICATION_ID, buildNotification(false))
        }
    }

    private fun updateNotification(connected: Boolean) {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIFICATION_ID, buildNotification(connected))
    }

    private fun buildNotification(connected: Boolean): Notification {
        val pending = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("HyperClaw")
                .setContentText(if (connected) "Connected" else "Connecting…")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pending)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("HyperClaw")
                .setContentText(if (connected) "Connected" else "Connecting…")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pending)
                .setOngoing(true)
                .build()
        }
    }

    companion object {
        const val ACTION_START = "ai.hyperclaw.START"
        const val ACTION_STOP = "ai.hyperclaw.STOP"
        private const val CHANNEL_ID = "hyperclaw_connection"
        private const val NOTIFICATION_ID = 1001

        fun start(context: Context) {
            context.startForegroundService(Intent(context, ConnectionService::class.java).apply {
                action = ACTION_START
            })
        }

        fun stop(context: Context) {
            context.startService(Intent(context, ConnectionService::class.java).apply {
                action = ACTION_STOP
            })
        }
    }
}
