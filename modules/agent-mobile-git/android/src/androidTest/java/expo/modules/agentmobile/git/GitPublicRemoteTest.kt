package expo.modules.agentmobile.git

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

/** Explicit public-service smoke test; local interoperability remains deterministic. */
class GitPublicRemoteTest {
  @Test fun publicProductRpc() {
    val args = InstrumentationRegistry.getArguments()
    val url = args.getString("remote") ?: "https://github.com/octocat/Hello-World.git"
    val runner = GitRepositoryRunner(InstrumentationRegistry.getInstrumentation().targetContext.filesDir)
    val id = "public-" + System.currentTimeMillis()
    fun call(projectId: String, method: String, vararg args: Pair<String, Any?>): JSONObject {
      val input = JSONObject().put("method", method); args.forEach { (key, value) -> input.put(key, value ?: JSONObject.NULL) }
      val result = JSONObject(runner.execute(projectId, UUID.randomUUID().toString(), input.toString()) { _, _, _, _ -> })
      assertTrue(method + ": " + result.toString(), result.getBoolean("ok")); return result
    }
    try {
      call(id, "init")
      call(id, "remoteSave", "name" to "origin", "url" to url)
      call(id, "fetch", "name" to "origin")
      call("public-clone-" + System.currentTimeMillis(), "clone", "url" to url, "operationId" to UUID.randomUUID().toString())
    } finally { runner.close() }
  }
}
