package ai.hyperclaw

import org.junit.Assert.assertEquals
import org.junit.Test

class ChatMessageTest {

    @Test
    fun chatMessage_hasCorrectRole() {
        val msg = ChatMessage(role = ChatMessage.Role.USER, content = "hello")
        assertEquals(ChatMessage.Role.USER, msg.role)
        assertEquals("hello", msg.content)
    }

    @Test
    fun chatMessage_hasIdAndTimestamp() {
        val msg = ChatMessage(role = ChatMessage.Role.ASSISTANT, content = "hi")
        assertEquals(ChatMessage.Role.ASSISTANT, msg.role)
        assert(msg.id > 0)
        assert(msg.timestamp > 0)
    }
}
