package expo.modules.agentmobile.git

import androidx.test.platform.app.InstrumentationRegistry
import android.system.Os
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

/** Each case owns its repositories and outside sentinel; no device/user data is used. */
class GitPermissionTest {
  private class Fixture : AutoCloseable {
    val runner = GitRepositoryRunner(InstrumentationRegistry.getInstrumentation().targetContext.filesDir)
    val id = "permissions-" + UUID.randomUUID()
    val directory = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir,
      "agent-mobile/workspaces/$id/repository")
    fun request(method: String, vararg args: Pair<String, Any?>): JSONObject {
      val input = JSONObject().put("method", method)
      args.forEach { (key, value) -> input.put(key, value ?: JSONObject.NULL) }
      return JSONObject(runner.execute(id, UUID.randomUUID().toString(), input.toString()) { _, _, _, _ -> })
    }
    fun success(method: String, vararg args: Pair<String, Any?>): Any {
      val result = request(method, *args)
      assertTrue(result.toString(), result.getBoolean("ok"))
      return result.get("value")
    }
    fun denied(method: String, vararg args: Pair<String, Any?>) {
      val result = request(method, *args)
      assertFalse("Unexpected success: $result", result.getBoolean("ok"))
      assertEquals(result.toString(), "VALIDATION", result.getString("code"))
    }
    init { success("init") }
    override fun close() { runner.close() }
  }

  @Test fun commitCannotTraverseSymlinkParent() = Fixture().use { f ->
    val outside = f.directory.parentFile!!.resolve("outside").apply { mkdir() }
    val sentinel = outside.resolve("private.txt").apply { writeText("private fixture") }
    Os.symlink(outside.path, f.directory.resolve("portal").path)
    val index = f.success("index").toString()
    f.denied("commit", "paths" to JSONArray(listOf("portal/private.txt")), "message" to "blocked")
    assertEquals(index, f.success("index").toString())
    assertEquals(JSONObject.NULL, f.success("head"))
    assertEquals("private fixture", sentinel.readText())
  }

  @Test fun gitDirectoryCannotRedirectToAnotherProject() = Fixture().use { a ->
    Fixture().use { b ->
      val foreignConfig = b.directory.resolve(".git/config")
      val before = foreignConfig.readText()
      assertTrue(a.directory.resolve(".git").renameTo(a.directory.parentFile!!.resolve("owned-git")))
      Os.symlink(b.directory.resolve(".git").path, a.directory.resolve(".git").path)
      a.denied("identity", "name" to "forbidden", "email" to "fixture@example.invalid")
      assertEquals(before, foreignConfig.readText())
    }
  }

  @Test fun worktreeConfigurationCannotRedirectReads() = Fixture().use { f ->
    val outside = f.directory.parentFile!!.resolve("outside").apply { mkdir() }
    outside.resolve("note.txt").writeText("private fixture")
    f.directory.resolve("note.txt").writeText("public fixture")
    f.directory.resolve(".git/config").appendText("\n[core]\n\tworktree = ${outside.path}\n")
    f.denied("stageEntries", "paths" to JSONArray(listOf("note.txt")))
    assertEquals("private fixture", outside.resolve("note.txt").readText())
  }

  @Test fun temporaryWritesCannotFollowPrivateDirectoryLinks() = Fixture().use { f ->
    val outside = f.directory.parentFile!!.resolve("outside").apply { mkdir() }
    Os.symlink(outside.path, f.directory.resolve(".git/agent-mobile").path)
    f.denied("fileWrite", "path" to "note.txt", "bytes" to "aGVsbG8=")
    assertFalse(f.directory.resolve("note.txt").exists())
    assertEquals(emptyList<String>(), outside.list()!!.toList())
  }

  @Test fun objectWritesCannotFollowForeignObjectDirectory() = Fixture().use { a ->
    Fixture().use { b ->
      assertTrue(a.directory.resolve(".git/objects").renameTo(a.directory.parentFile!!.resolve("owned-objects")))
      val foreign = b.directory.resolve(".git/objects")
      val before = foreign.walkTopDown().map { it.relativeTo(foreign).path }.toList().sorted()
      Os.symlink(foreign.path, a.directory.resolve(".git/objects").path)
      a.denied("writeBlob", "bytes" to "cHJpdmF0ZSBmaXh0dXJl")
      assertEquals(before, foreign.walkTopDown().map { it.relativeTo(foreign).path }.toList().sorted())
    }
  }
}
