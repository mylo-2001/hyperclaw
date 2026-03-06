package ai.hyperclaw

import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import android.Manifest
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

/**
 * Node commands for SMS, contacts, calendar, motion.
 * OpenClaw-level mobile node depth.
 */

object NodeCommands {

    fun hasPermission(ctx: Context, perm: String): Boolean =
        ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED

    // ─── SMS ─────────────────────────────────────────────────────────────────────

    suspend fun smsSend(ctx: Context, to: String, body: String): Result<String> = withContext(Dispatchers.IO) {
        if (!hasPermission(ctx, Manifest.permission.SEND_SMS)) {
            return@withContext Result.failure(SecurityException("SEND_SMS permission required"))
        }
        try {
            val sms = SmsManager.getDefault()
            val parts = sms.divideMessage(body)
            if (parts.size == 1) sms.sendTextMessage(to, null, body, null, null)
            else sms.sendMultipartTextMessage(to, null, parts, null, null)
            Result.success("SMS sent to $to")
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun smsListRecent(ctx: Context, limit: Int = 20): Result<String> = withContext(Dispatchers.IO) {
        if (!hasPermission(ctx, Manifest.permission.READ_SMS)) {
            return@withContext Result.failure(SecurityException("READ_SMS permission required"))
        }
        try {
            val cr = ctx.contentResolver
            val uri = Uri.parse("content://sms/inbox")
            val cursor = cr.query(uri, arrayOf("address", "body", "date"), null, null, "date DESC")
            val arr = JSONArray()
            cursor?.use {
                var i = 0
                while (it.moveToNext() && i < limit) {
                    arr.put(JSONObject().apply {
                        put("from", it.getString(0))
                        put("body", it.getString(1)?.take(200))
                        put("date", it.getLong(2))
                    })
                    i++
                }
            }
            Result.success(arr.toString())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ─── Contacts ────────────────────────────────────────────────────────────────

    suspend fun contactsList(ctx: Context, limit: Int = 50): Result<String> = withContext(Dispatchers.IO) {
        if (!hasPermission(ctx, Manifest.permission.READ_CONTACTS)) {
            return@withContext Result.failure(SecurityException("READ_CONTACTS permission required"))
        }
        try {
            val cr = ctx.contentResolver
            val uri = ContactsContract.Contacts.CONTENT_URI
            val cursor = cr.query(uri, arrayOf(
                ContactsContract.Contacts._ID,
                ContactsContract.Contacts.DISPLAY_NAME
            ), null, null, "${ContactsContract.Contacts.DISPLAY_NAME} ASC")
            val arr = JSONArray()
            cursor?.use {
                var i = 0
                while (it.moveToNext() && i < limit) {
                    val id = it.getString(0)
                    val name = it.getString(1) ?: ""
                    var phone: String? = null
                    val phoneCur = cr.query(
                        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                        arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
                        "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID}=?",
                        arrayOf(id),
                        null
                    )
                    phoneCur?.use { if (it.moveToFirst()) phone = it.getString(0) }
                    arr.put(JSONObject().apply {
                        put("name", name)
                        put("phone", phone ?: "")
                    })
                    i++
                }
            }
            Result.success(arr.toString())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ─── Calendar ────────────────────────────────────────────────────────────────

    suspend fun calendarEvents(ctx: Context, daysAhead: Int = 7): Result<String> = withContext(Dispatchers.IO) {
        if (!hasPermission(ctx, Manifest.permission.READ_CALENDAR)) {
            return@withContext Result.failure(SecurityException("READ_CALENDAR permission required"))
        }
        try {
            val cr = ctx.contentResolver
            val now = System.currentTimeMillis()
            val end = now + daysAhead * 24L * 60 * 60 * 1000
            val uri = CalendarContract.Events.CONTENT_URI.buildUpon()
                .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "false")
                .build()
            val cursor = cr.query(
                uri,
                arrayOf(
                    CalendarContract.Events._ID,
                    CalendarContract.Events.TITLE,
                    CalendarContract.Events.DTSTART,
                    CalendarContract.Events.DTEND,
                    CalendarContract.Events.EVENT_LOCATION
                ),
                "${CalendarContract.Events.DTSTART} >= ? AND ${CalendarContract.Events.DTSTART} <= ?",
                arrayOf(now.toString(), end.toString()),
                "${CalendarContract.Events.DTSTART} ASC"
            )
            val arr = JSONArray()
            cursor?.use {
                while (it.moveToNext()) {
                    arr.put(JSONObject().apply {
                        put("title", it.getString(1) ?: "")
                        put("start", it.getLong(2))
                        put("end", it.getLong(3))
                        put("location", it.getString(4) ?: "")
                    })
                }
            }
            Result.success(arr.toString())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ─── Motion (accelerometer sample) ───────────────────────────────────────────

    suspend fun motionSample(ctx: Context): Result<String> = withContext(Dispatchers.Main) {
        if (!hasPermission(ctx, Manifest.permission.BODY_SENSORS)) {
            return@withContext Result.failure(SecurityException("BODY_SENSORS permission required"))
        }
        val sm = ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        val accel = sm?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (accel == null) return@withContext Result.failure(IllegalStateException("Accelerometer not available"))
        suspendCancellableCoroutine { cont ->
            var sample: FloatArray? = null
            val listener = object : SensorEventListener {
                override fun onSensorChanged(e: SensorEvent) {
                    sample = e.values.copyOf()
                }
                override fun onAccuracyChanged(s: Sensor?, a: Int) {}
            }
            sm.registerListener(listener, accel, SensorManager.SENSOR_DELAY_NORMAL)
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                sm.unregisterListener(listener)
                val s = sample ?: floatArrayOf(0f, 0f, 0f)
                cont.resume(Result.success(JSONObject().apply {
                    put("x", s.getOrNull(0) ?: 0)
                    put("y", s.getOrNull(1) ?: 0)
                    put("z", s.getOrNull(2) ?: 0)
                }.toString())) {}
            }, 300)
        }
    }
}
