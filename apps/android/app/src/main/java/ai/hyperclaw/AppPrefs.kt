package ai.hyperclaw

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "hyperclaw_prefs")

object AppPrefs {
    private val GATEWAY_URL = stringPreferencesKey("gateway_url")
    private val GATEWAY_TOKEN = stringPreferencesKey("gateway_token")
    private val MESSAGES_JSON = stringPreferencesKey("messages_json")
    private val NODE_ID = stringPreferencesKey("node_id")
    private val PREVIOUS_SESSION_ID = stringPreferencesKey("previous_session_id")

    fun gatewayUrlFlow(context: Context): Flow<String?> =
        context.dataStore.data.map { it[GATEWAY_URL] }

    fun gatewayTokenFlow(context: Context): Flow<String?> =
        context.dataStore.data.map { it[GATEWAY_TOKEN] }

    suspend fun setGatewayUrl(context: Context, url: String) {
        context.dataStore.edit { it[GATEWAY_URL] = url }
    }

    suspend fun setGatewayToken(context: Context, token: String?) {
        context.dataStore.edit {
            if (token != null) it[GATEWAY_TOKEN] = token else it.remove(GATEWAY_TOKEN)
        }
    }

    suspend fun getGatewayUrl(context: Context): String? =
        context.dataStore.data.first()[GATEWAY_URL]

    suspend fun getGatewayToken(context: Context): String? =
        context.dataStore.data.first()[GATEWAY_TOKEN]

    suspend fun setMessages(context: Context, json: String) {
        context.dataStore.edit { it[MESSAGES_JSON] = json }
    }

    suspend fun getMessages(context: Context): String? =
        context.dataStore.data.first()[MESSAGES_JSON]

    suspend fun setNodeId(context: Context, id: String) {
        context.dataStore.edit { it[NODE_ID] = id }
    }

    suspend fun getNodeId(context: Context): String? =
        context.dataStore.data.first()[NODE_ID]

    suspend fun setPreviousSessionId(context: Context, id: String) {
        context.dataStore.edit { it[PREVIOUS_SESSION_ID] = id }
    }

    suspend fun getPreviousSessionId(context: Context): String? =
        context.dataStore.data.first()[PREVIOUS_SESSION_ID]
}
