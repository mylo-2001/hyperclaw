package ai.hyperclaw

import android.content.Context
import android.content.pm.PackageManager
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume

suspend fun getCurrentLocation(context: Context): String {
    if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
        return "Location permission required"
    val client: FusedLocationProviderClient = LocationServices.getFusedLocationProviderClient(context)
    return suspendCancellableCoroutine { cont ->
        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                client.removeLocationUpdates(this)
                cont.resume("Location: ${loc.latitude},${loc.longitude} (accuracy ~${loc.accuracy.toInt()}m)")
            }
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, TimeUnit.SECONDS.toMillis(10))
            .setMaxUpdates(1)
            .build()
        try {
            client.requestLocationUpdates(request, callback, Looper.getMainLooper())
        } catch (e: SecurityException) {
            cont.resume("Location permission denied")
        }
        cont.invokeOnCancellation { client.removeLocationUpdates(callback) }
    }
}
