package ai.hyperclaw

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppPrefsTest {

    private lateinit var context: Context

    @Before
    fun setup() {
        context = ApplicationProvider.getApplicationContext()
    }

    @Test
    fun gatewayUrl_persists() = runBlocking {
        AppPrefs.setGatewayUrl(context, "ws://test:18789")
        val url = AppPrefs.getGatewayUrl(context)
        Assert.assertEquals("ws://test:18789", url)
    }

    @Test
    fun gatewayToken_persists() = runBlocking {
        AppPrefs.setGatewayToken(context, "secret123")
        val token = AppPrefs.getGatewayToken(context)
        Assert.assertEquals("secret123", token)
    }

    @Test
    fun gatewayToken_clearsWhenNull() = runBlocking {
        AppPrefs.setGatewayToken(context, "x")
        AppPrefs.setGatewayToken(context, null)
        Assert.assertNull(AppPrefs.getGatewayToken(context))
    }
}
