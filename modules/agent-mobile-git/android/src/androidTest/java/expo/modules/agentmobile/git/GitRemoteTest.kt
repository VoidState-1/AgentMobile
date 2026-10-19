package expo.modules.agentmobile.git

import android.os.Bundle
import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeNotNull
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.util.UUID
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory

/** A pinned, generated local test certificate; the product trust policy is never changed. */
class GitRemoteTest {
  @Test fun authenticatedHttpsPushFetchAndUnknownResult() {
    val args = InstrumentationRegistry.getArguments()
    val certificate = args.getString("fixtureCertificate")
    val port = args.getString("fixturePort")
    val password = args.getString("fixturePassword")
    assumeNotNull(certificate, port, password)
    val original = SSLContext.getDefault()
    val trust = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
      load(null)
      setCertificateEntry("local-fixture", CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(Base64.decode(certificate, Base64.DEFAULT))))
    }
    val managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(trust) }
    SSLContext.setDefault(SSLContext.getInstance("TLS").apply { init(null, managers.trustManagers, null) })
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val runner = GitRepositoryRunner(context.filesDir)
    val id = "remote-" + System.currentTimeMillis()
    val directory = File(context.filesDir, "agent-mobile/workspaces/$id/repository")
    val credential = JSONObject().put("username", "mobile").put("password", password)
    var events = 0
    fun request(method: String, vararg arguments: Pair<String, Any?>): JSONObject {
      val input = JSONObject().put("method", method).put("credential", credential)
      arguments.forEach { (key, value) -> input.put(key, value ?: JSONObject.NULL) }
      return JSONObject(runner.execute(id, UUID.randomUUID().toString(), input.toString()) { _, _, _, _ -> events++ })
    }
    fun call(method: String, vararg arguments: Pair<String, Any?>): Any? {
      val result = request(method, *arguments)
      assertTrue(result.toString(), result.getBoolean("ok"))
      return result.get("value").let { if (it == JSONObject.NULL) null else it }
    }
    fun guard(remoteHead: String?): JSONObject {
      val info = call("overview") as JSONObject
      return JSONObject().put("operationId", UUID.randomUUID().toString()).put("head", info.getJSONObject("head").get("oid")).put("branch", info.getJSONObject("head").get("branch")).put("remoteHead", remoteHead ?: JSONObject.NULL)
    }
    fun commit(value: String): String {
      directory.resolve("hello.txt").writeText(value)
      return call("commit", "paths" to JSONArray(listOf("hello.txt")), "message" to value) as String
    }
    try {
      call("init")
      val first = commit("first")
      call("remoteSave", "name" to "origin", "url" to "https://127.0.0.1:$port/repo.git")
      assertNull(call("remoteHead", "name" to "origin", "branch" to "main"))
      call("push", "name" to "origin", "branch" to "main", "guard" to guard(null))
      assertEquals(first, call("remoteHead", "name" to "origin", "branch" to "main"))
      val second = commit("second")
      val stale = request("push", "name" to "origin", "branch" to "main", "guard" to guard(null))
      assertEquals(stale.toString(), "CONFLICT", stale.getString("code"))
      call("push", "name" to "origin", "branch" to "main", "guard" to guard(first))
      call("fetch", "name" to "origin")
      call("upstream", "name" to "main", "upstream" to "origin/main")
      val branch = (call("overview") as JSONObject).getJSONArray("branches").let { branches -> (0 until branches.length()).map { branches.getJSONObject(it) }.first { it.getString("name") == "main" && !it.getBoolean("remote") } }
      assertEquals("origin/main", branch.getString("upstream"))
      directory.resolve(".git/refs/remotes/origin/HEAD").writeText("ref: refs/remotes/origin/main\n")
      call("upstream", "name" to "main", "upstream" to "origin/HEAD")
      val symbolicUpstream = (call("overview") as JSONObject).getJSONArray("branches").let { branches -> (0 until branches.length()).map { branches.getJSONObject(it) }.first { it.getString("name") == "main" && !it.getBoolean("remote") } }
      assertEquals("origin/HEAD", symbolicUpstream.getString("upstream"))
      assertEquals(0, symbolicUpstream.getInt("ahead"))
      call("upstream", "name" to "main", "upstream" to "origin/main")
      call("changeHead", "before" to JSONObject().put("branch", "main").put("oid", second), "after" to JSONObject().put("branch", JSONObject.NULL).put("oid", first))
      val nonFastForward = request("push", "name" to "origin", "branch" to "main", "guard" to guard(second))
      assertEquals(nonFastForward.toString(), "CONFLICT", nonFastForward.getString("code"))
      assertEquals(second, call("remoteHead", "name" to "origin", "branch" to "main"))
      call("changeHead", "before" to JSONObject().put("branch", JSONObject.NULL).put("oid", first), "after" to JSONObject().put("branch", "main").put("oid", second))
      val third = commit("third-response-lost")
      call("remoteSave", "name" to "drop", "url" to "https://127.0.0.1:$port/drop.git")
      val unknown = request("push", "name" to "drop", "branch" to "main", "guard" to guard(second))
      assertEquals(unknown.toString(), "UNKNOWN", unknown.getString("code"))
      assertTrue(unknown.getBoolean("uncertain"))
      assertEquals(third, call("remoteHead", "name" to "drop", "branch" to "main"))
      val cloneId = "clone-" + System.currentTimeMillis()
      val cloneOperationId = UUID.randomUUID().toString()
      val cloneDirectory = File(context.filesDir, "agent-mobile/workspaces/$cloneId/repository")
      fun cloned(method: String, operationId: String = cloneOperationId, cancelled: Boolean = false): JSONObject {
        val input = JSONObject().put("method", method).put("url", "https://127.0.0.1:$port/repo.git").put("operationId", cloneOperationId).put("credential", credential)
        return JSONObject(runner.execute(cloneId, operationId, input.toString()) { phase, done, _, _ -> if (cancelled && phase == "checkout" && done > 0) runner.cancel(operationId) })
      }
      val copied = cloned("clone")
      assertTrue(copied.toString(), copied.getBoolean("ok"))
      assertEquals("third-response-lost", cloneDirectory.resolve("hello.txt").readText())
      assertFalse("Clone added application template files", cloneDirectory.resolve("notes").exists())
      assertEquals("published", cloned("cloneState").getString("value"))
      assertTrue("Completed clone retry must be idempotent", cloned("clone").getBoolean("ok"))
      val staging = File(cloneDirectory.parentFile, "clone-staging")
      assertTrue(cloneDirectory.renameTo(staging))
      assertEquals("ready", cloned("cloneState").getString("value"))
      assertTrue(cloned("publishClone").getBoolean("ok"))
      assertEquals("published", cloned("cloneState").getString("value"))
      assertEquals("VALIDATION", cloned("discardClone").getString("code"))
      val cancelledClone = "cancelled-clone-" + System.currentTimeMillis()
      val cancelledOperation = UUID.randomUUID().toString()
      val cancelledInput = JSONObject().put("method", "clone").put("url", "https://127.0.0.1:$port/repo.git").put("operationId", cancelledOperation).put("credential", credential)
      val cancellation = JSONObject(runner.execute(cancelledClone, cancelledOperation, cancelledInput.toString()) { phase, done, _, _ -> if (phase == "checkout" && done > 0) runner.cancel(cancelledOperation) })
      assertEquals(cancellation.toString(), "CANCELLED", cancellation.getString("code"))
      assertFalse(File(context.filesDir, "agent-mobile/workspaces/$cancelledClone/repository").exists())
      val discard = JSONObject(runner.execute(cancelledClone, UUID.randomUUID().toString(), "{\"method\":\"discardClone\"}") { _, _, _, _ -> })
      assertTrue(discard.getBoolean("ok"))
      val emptyClone = "empty-clone-" + System.currentTimeMillis()
      val emptyInput = JSONObject().put("method", "clone").put("url", "https://127.0.0.1:$port/empty.git").put("operationId", UUID.randomUUID().toString()).put("credential", credential)
      val empty = JSONObject(runner.execute(emptyClone, UUID.randomUUID().toString(), emptyInput.toString()) { _, _, _, _ -> })
      assertTrue(empty.toString(), empty.getBoolean("ok"))
      assertFalse(File(context.filesDir, "agent-mobile/workspaces/$emptyClone/repository/notes").exists())
      credential.put("password", "wrong-fixture-token")
      val rejected = request("remoteHead", "name" to "origin", "branch" to "main")
      assertFalse(rejected.getBoolean("ok"))
      assertFalse(rejected.toString().contains("wrong-fixture-token"))
      assertFalse(directory.resolve(".git/config").readText().contains(password!!))
      assertTrue("No network progress", events > 0)
      InstrumentationRegistry.getInstrumentation().sendStatus(2, Bundle().apply { putString("gitRemoteReport", JSONObject().put("head", third).put("progressEvents", events).toString()) })
    } finally { runner.close(); SSLContext.setDefault(original) }
  }
}
