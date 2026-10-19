package expo.modules.agentmobile.git

import androidx.test.platform.app.InstrumentationRegistry
import android.util.Base64
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class GitRepositoryTest {
  @Test fun switchBetweenFileAndDirectory() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val runner = GitRepositoryRunner(context.filesDir)
    val id = "shape-" + System.currentTimeMillis()
    val directory = File(context.filesDir, "agent-mobile/workspaces/$id/repository")
    fun call(method: String, vararg args: Pair<String, Any?>): Any? {
      val request = JSONObject().put("method", method); args.forEach { (key, value) -> request.put(key, value ?: JSONObject.NULL) }
      val result = JSONObject(runner.execute(id, UUID.randomUUID().toString(), request.toString()) { _, _, _, _ -> })
      assertTrue(result.toString(), result.getBoolean("ok")); return result.get("value")
    }
    call("init")
    directory.resolve(".gitignore").writeText("shape/hidden\n")
    directory.resolve("shape").writeText("flat")
    val first = call("commit", "paths" to org.json.JSONArray(listOf(".gitignore", "shape")), "message" to "flat") as String
    call("branchCreate", "name" to "flat")
    directory.resolve("shape").delete(); directory.resolve("shape").mkdir()
    directory.resolve("shape/nested.txt").writeText("nested")
    call("setIndex", "entries" to call("stageEntries", "paths" to org.json.JSONArray(listOf("shape", "shape/nested.txt"))))
    val snapshot = call("checkpoint", "files" to call("index"), "key" to "shape/second", "parent" to first) as String
    val second = call("commitSnapshot", "snapshot" to snapshot, "expectedHead" to first, "message" to "nested") as String
    fun switch(target: String, branch: String) {
      val before = (call("overview") as JSONObject).getJSONObject("head")
      val plan = call("switchPlan", "target" to target) as JSONObject
      call("applyWorktree", "changes" to plan.getJSONArray("changes"))
      val index = call("index") as JSONObject; val after = plan.getJSONObject("index"); val update = JSONObject()
      (index.keys().asSequence().toList() + after.keys().asSequence().toList()).distinct().forEach { path -> update.put(path, after.opt(path) ?: JSONObject.NULL) }
      call("setIndex", "entries" to update)
      call("changeHead", "before" to JSONObject().put("branch", before.get("branch")).put("oid", before.get("oid")), "after" to JSONObject().put("branch", branch).put("oid", target))
      assertEquals(0, (call("status") as JSONObject).getJSONArray("files").length())
    }
    switch(first, "flat"); assertEquals("flat", directory.resolve("shape").readText())
    assertEquals(0, (call("workingTree", "paths" to org.json.JSONArray(listOf("shape/nested.txt"))) as JSONObject).length())
    assertTrue((call("stageEntries", "paths" to org.json.JSONArray(listOf("shape/nested.txt"))) as JSONObject).isNull("shape/nested.txt"))
    switch(second, "main"); assertEquals("nested", directory.resolve("shape/nested.txt").readText())
    // A third-party ignored file must block the batch before the tracked nested file is deleted.
    val plan = call("switchPlan", "target" to first) as JSONObject
    directory.resolve("shape/hidden").writeText("keep")
    val rejected = JSONObject(runner.execute(id, UUID.randomUUID().toString(), JSONObject().put("method", "applyWorktree").put("changes", plan.getJSONArray("changes")).toString()) { _, _, _, _ -> })
    assertEquals("CONFLICT", rejected.getString("code"))
    assertEquals("keep", directory.resolve("shape/hidden").readText())
    assertEquals("nested", directory.resolve("shape/nested.txt").readText())
    runner.close()
  }
  @Test fun abandonedLocksAndCrossContextCancellation() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val first = GitRepositoryRunner(context.filesDir)
    val second = GitRepositoryRunner(context.filesDir)
    val id = "locks-" + System.currentTimeMillis()
    val directory = File(context.filesDir, "agent-mobile/workspaces/$id/repository")
    fun call(runner: GitRepositoryRunner, method: String): JSONObject = JSONObject(runner.execute(id, UUID.randomUUID().toString(), JSONObject().put("method", method).toString()) { _, _, _, _ -> })
    assertTrue(call(first, "init").getBoolean("ok"))
    val cancelledBeforeDispatch = UUID.randomUUID().toString()
    second.cancel(cancelledBeforeDispatch)
    val notStarted = JSONObject(second.execute(id, cancelledBeforeDispatch, "{\"method\":\"head\"}") { _, _, _, _ -> })
    assertEquals("CANCELLED", notStarted.getString("code"))
    val stale = listOf("index.lock", "HEAD.lock", "config.lock", "packed-refs.lock", "refs/heads/main.lock", "logs/refs/heads/main.lock")
    stale.forEach { path -> directory.resolve(".git/$path").apply { parentFile?.mkdirs(); writeText("unfinished") } }
    val retained = directory.resolve(".git/objects/info/user.lock").apply { parentFile?.mkdirs(); writeText("retained") }
    val working = directory.resolve("user.lock").apply { writeText("working file") }
    val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
    val entered = java.util.concurrent.CountDownLatch(1)
    val release = java.util.concurrent.CountDownLatch(1)
    try {
      val recovery = pool.submit<String> {
        first.execute(id, UUID.randomUUID().toString(), "{\"method\":\"recoverLocks\"}") { phase, done, _, _ ->
          if (phase == "recover-locks" && done == 0) { entered.countDown(); check(release.await(10, java.util.concurrent.TimeUnit.SECONDS)) }
        }
      }
      assertTrue(entered.await(5, java.util.concurrent.TimeUnit.SECONDS))
      val operationId = UUID.randomUUID().toString()
      val queued = pool.submit<String> { second.execute(id, operationId, "{\"method\":\"head\"}") { _, _, _, _ -> } }
      Thread.sleep(100)
      assertFalse("A second bridge entered the repository while recovery held its lease", queued.isDone)
      second.cancel(operationId)
      assertEquals("CANCELLED", JSONObject(queued.get(5, java.util.concurrent.TimeUnit.SECONDS)).getString("code"))
      release.countDown()
      assertTrue(JSONObject(recovery.get(5, java.util.concurrent.TimeUnit.SECONDS)).getBoolean("ok"))
      stale.forEach { path -> assertFalse(path, directory.resolve(".git/$path").exists()) }
      assertEquals("retained", retained.readText())
      assertEquals("working file", working.readText())
      assertTrue(call(second, "overview").getBoolean("ok"))
      // A link presented as a Git lock must cause a complete refusal, without partial cleanup.
      directory.resolve(".git/index.lock").writeText("keep until inspected")
      android.system.Os.symlink(working.path, directory.resolve(".git/HEAD.lock").path)
      assertEquals("VALIDATION", call(first, "recoverLocks").getString("code"))
      assertEquals("keep until inspected", directory.resolve(".git/index.lock").readText())
      assertEquals("working file", working.readText())
    } finally { release.countDown(); pool.shutdownNow(); first.close(); second.close() }
  }
  @Test fun objectSnapshotsModesLargeFilesAndFilters() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val runner = GitRepositoryRunner(context.filesDir)
    val id = "objects-" + System.currentTimeMillis()
    val directory = File(context.filesDir, "agent-mobile/workspaces/$id/repository")
    fun request(method: String, vararg args: Pair<String, Any?>): JSONObject {
      val value = JSONObject().put("method", method)
      args.forEach { (key, data) -> value.put(key, data ?: JSONObject.NULL) }
      return JSONObject(runner.execute(id, UUID.randomUUID().toString(), value.toString()) { _, _, _, _ -> })
    }
    fun call(method: String, vararg args: Pair<String, Any?>): Any? {
      val result = request(method, *args); assertTrue(result.toString(), result.getBoolean("ok")); return result.get("value")
    }
    fun encoded(text: String) = Base64.encodeToString(text.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
    fun paths(vararg names: String) = org.json.JSONArray(names.toList())
    fun tree() = call("workingTree") as JSONObject
    call("init")
    directory.resolve(".gitattributes").writeText("*.txt text eol=lf\n")
    directory.resolve("line.txt").writeText("a\r\nb\r\n")
    directory.resolve("run.sh").writeText("#!/bin/sh\necho hi\n")
    android.system.Os.chmod(directory.resolve("run.sh").path, 493)
    android.system.Os.symlink("run.sh", directory.resolve("run-link").path)
    java.io.RandomAccessFile(directory.resolve("large.bin"), "rw").use { it.setLength(24L * 1024 * 1024) }
    val working = tree()
    assertTrue("Snapshot transferred file bytes", working.toString().length < 2048)
    assertEquals(33261, working.getJSONObject("run.sh").getInt("mode"))
    assertEquals(40960, working.getJSONObject("run-link").getInt("mode"))
    assertEquals(24L * 1024 * 1024, (call("blobInfo", "oid" to working.getJSONObject("large.bin").getString("revision")) as JSONObject).getLong("size"))
    val staged = call("stageEntries", "paths" to paths(".gitattributes", "line.txt", "run.sh", "run-link", "large.bin")) as JSONObject
    assertEquals(0, (call("index") as JSONObject).length())
    assertNotEquals(working.getJSONObject("line.txt").getString("revision"), staged.getJSONObject("line.txt").getString("revision"))
    assertEquals(encoded("a\nb\n"), call("blob", "oid" to staged.getJSONObject("line.txt").getString("revision")))
    call("setIndex", "entries" to staged)
    val snapshot = call("checkpoint", "files" to staged, "key" to "objects/index", "parent" to "") as String
    val first = call("commitSnapshot", "snapshot" to snapshot, "expectedHead" to null, "message" to "first") as String
    assertEquals(0, (call("status") as JSONObject).getJSONArray("files").length())
    val rawSnapshot = call("checkpoint", "files" to working, "key" to "objects/raw", "parent" to first) as String
    val cleanArgs = arrayOf("head" to first, "indexSnapshot" to snapshot, "workingSnapshot" to rawSnapshot, "paths" to paths("line.txt"))
    assertEquals(0, (call("uncommittedPaths", *cleanArgs) as org.json.JSONArray).length())
    directory.resolve(".gitattributes").writeText("*.txt -text\n")
    val changedAttributes = JSONObject().put("revision", call("writeBlob", "bytes" to encoded("*.txt -text\n"))).put("mode", 33188)
    call("setIndex", "entries" to JSONObject().put(".gitattributes", changedAttributes))
    assertEquals("Task recovery read later attributes", 0, (call("uncommittedPaths", *cleanArgs) as org.json.JSONArray).length())
    directory.resolve(".gitattributes").writeText("*.txt text eol=lf\n")
    call("setIndex", "entries" to JSONObject().put(".gitattributes", staged.getJSONObject(".gitattributes")))
    android.system.Os.chmod(directory.resolve("run.sh").path, 420)
    val changed = call("status") as JSONObject
    assertEquals(1, changed.getJSONArray("files").length())
    assertEquals(33188, changed.getJSONArray("files").getJSONObject(0).getInt("workingMode"))
    val newMode = call("stageEntries", "paths" to paths("run.sh")) as JSONObject
    call("setIndex", "entries" to newMode)
    val nextSnapshot = call("checkpoint", "files" to call("index"), "key" to "objects/mode", "parent" to first) as String
    call("commitSnapshot", "snapshot" to nextSnapshot, "expectedHead" to first, "message" to "mode")
    val now = (call("workingTree", "paths" to paths("run.sh")) as JSONObject).getJSONObject("run.sh")
    call("applyWorktree", "changes" to org.json.JSONArray().put(JSONObject().put("path", "run.sh").put("before", now).put("after", working.getJSONObject("run.sh"))))
    assertTrue(android.system.Os.stat(directory.resolve("run.sh").path).st_mode and 64 != 0)
    val linkBefore = working.getJSONObject("run-link")
    val regular = JSONObject().put("revision", call("writeBlob", "bytes" to encoded("plain"))).put("mode", 33188)
    call("applyWorktree", "changes" to org.json.JSONArray().put(JSONObject().put("path", "run-link").put("before", linkBefore).put("after", regular)))
    assertEquals("plain", directory.resolve("run-link").readText())
    call("applyWorktree", "changes" to org.json.JSONArray().put(JSONObject().put("path", "run-link").put("before", regular).put("after", linkBefore)))
    assertEquals("run.sh", android.system.Os.readlink(directory.resolve("run-link").path))
    val lineBefore = working.getJSONObject("line.txt")
    val desired = JSONObject().put("revision", call("writeBlob", "bytes" to encoded("desired"))).put("mode", 33188)
    val create = JSONObject().put("path", "new.txt").put("before", JSONObject.NULL).put("after", desired)
    val edit = JSONObject().put("path", "line.txt").put("before", lineBefore).put("after", desired)
    directory.resolve("line.txt").writeText("unexpected")
    val rejected = request("applyWorktree", "changes" to org.json.JSONArray().put(create).put(edit))
    assertEquals("CONFLICT", rejected.getString("code"))
    assertFalse(directory.resolve("new.txt").exists())
    directory.resolve("line.txt").writeText("a\r\nb\r\n")
    directory.resolve("new.txt").writeText("desired")
    call("applyWorktree", "changes" to org.json.JSONArray().put(create).put(edit))
    call("applyWorktree", "changes" to org.json.JSONArray().put(create).put(edit))
    assertEquals("desired", directory.resolve("line.txt").readText())
    val export = call("fileExport", "path" to "large.bin") as String
    assertEquals(24L * 1024 * 1024, File(java.net.URI(export)).length())
    runner.close()
  }
  @Test fun nativeFileBoundary() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val runner = GitRepositoryRunner(context.filesDir)
    val id = "filesystem-" + System.currentTimeMillis()
    val directory = File(context.filesDir, "agent-mobile/workspaces/$id/repository")
    fun request(method: String, vararg args: Pair<String, Any?>): JSONObject {
      val value = JSONObject().put("method", method)
      args.forEach { (key, data) -> value.put(key, data ?: JSONObject.NULL) }
      return JSONObject(runner.execute(id, UUID.randomUUID().toString(), value.toString()) { _, _, _, _ -> })
    }
    fun success(method: String, vararg args: Pair<String, Any?>): Any? {
      val result = request(method, *args); assertTrue(result.toString(), result.getBoolean("ok")); return result.get("value")
    }
    success("init")
    success("fileWrite", "path" to "nested/文档😀.txt", "bytes" to "aGVsbG8=")
    assertEquals("aGVsbG8=", success("fileRead", "path" to "nested/文档😀.txt"))
    assertEquals(success("revision", "bytes" to "aGVsbG8="), success("fileStamp", "path" to "nested/文档😀.txt"))
    success("fileMove", "path" to "nested/文档😀.txt", "to" to "moved.txt")
    assertEquals("ENOENT", request("fileRead", "path" to "nested/文档😀.txt").getString("code"))
    success("fileWrite", "path" to "existing.txt", "bytes" to "b3JpZ2luYWw=")
    assertEquals("CONFLICT", request("fileMove", "path" to "moved.txt", "to" to "existing.txt").getString("code"))
    assertEquals("aGVsbG8=", success("fileRead", "path" to "moved.txt"))
    assertEquals("b3JpZ2luYWw=", success("fileRead", "path" to "existing.txt"))
    val outside = File(directory.parentFile, "outside.txt").apply { writeText("private fixture") }
    android.system.Os.symlink(outside.path, File(directory, "link.txt").path)
    android.system.Os.symlink(directory.parentFile.path, File(directory, "portal").path)
    assertEquals("symlink", (success("fileStat", "path" to "link.txt") as JSONObject).getString("kind"))
    assertEquals(outside.path, String(Base64.decode(success("fileRead", "path" to "link.txt") as String, Base64.DEFAULT), Charsets.UTF_8))
    for (path in listOf("../outside.txt", ".git/config", "portal/outside.txt", "a//b", "a/CON.txt", "trail.", " leading.txt", "a\nb"))
      assertEquals("VALIDATION", request("fileRead", "path" to path).getString("code"))
    assertEquals("VALIDATION", request("fileWrite", "path" to "link.txt", "bytes" to "eA==").getString("code"))
    success("fileRemove", "path" to "link.txt")
    assertEquals("private fixture", outside.readText())
    runner.close()
  }
  @Test fun productRepositoryApi() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val runner = GitRepositoryRunner(context.filesDir)
    val projectId = "integration-" + System.currentTimeMillis()
    val directory = File(context.filesDir, "agent-mobile/workspaces/$projectId/repository")
    fun call(method: String, vararg arguments: Pair<String, Any?>): Any? {
      val request = JSONObject().put("method", method)
      arguments.forEach { (key, value) -> request.put(key, value ?: JSONObject.NULL) }
      val response = JSONObject(runner.execute(projectId, UUID.randomUUID().toString(), request.toString()) { _, _, _, _ -> })
      assertTrue(response.toString(), response.getBoolean("ok"))
      val value = response.get("value")
      return if (value == JSONObject.NULL) null else value
    }
    fun encoded(text: String) = Base64.encodeToString(text.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
    call("init")
    assertNull(call("head"))
    assertEquals("unborn", (call("overview") as JSONObject).getJSONObject("head").getString("kind"))
    call("identity", "name" to "开发者😀", "email" to "developer@example.invalid")
    directory.resolve("project.json").writeText("{\"custom\":true}\n")
    directory.resolve("文档😀.md").writeText("原始内容😀\n")
    val paths = org.json.JSONArray(listOf("project.json", "文档😀.md"))
    val first = call("commit", "paths" to paths, "message" to "首次提交😀") as String
    val history = (call("history") as JSONObject).getJSONArray("versions").getJSONObject(0)
    assertEquals("首次提交😀", history.getString("message").trim())
    assertEquals("开发者😀", history.getJSONObject("author").getString("name"))
    assertEquals(0, history.getJSONArray("parents").length())
    assertEquals(encoded("原始内容😀\n"), call("readAt", "ref" to first, "path" to "文档😀.md"))
    val next = "下一版😀\n"
    directory.resolve("文档😀.md").writeText(next)
    val revision = call("revision", "bytes" to encoded(next)) as String
    val snapshot = call("checkpoint", "files" to call("workingTree"), "key" to "integration/snapshot", "parent" to first) as String
    assertEquals(first, call("head"))
    assertEquals(snapshot, call("checkpointRef", "key" to "integration/snapshot"))
    call("setIndex", "entries" to JSONObject().put("文档😀.md", JSONObject().put("revision", revision).put("mode", 33188)))
    val second = call("commitSnapshot", "snapshot" to snapshot, "expectedHead" to first, "message" to "保存\n\nAgentMobile-Operation: integration") as String
    assertEquals(second, call("findOperation", "operationId" to "integration"))
    assertNull(call("findOperation", "operationId" to "integ"))
    assertEquals(revision, (call("index") as JSONObject).getJSONObject("文档😀.md").getString("revision"))
    val clean = call("overview") as JSONObject
    assertEquals(clean.toString(), 0, clean.getJSONArray("changes").length())
    call("branchCreate", "name" to "feature")
    fun checkout(name: String) {
      val info = call("overview") as JSONObject
      val branchList = info.getJSONArray("branches")
      val target = (0 until branchList.length()).map { branchList.getJSONObject(it) }.first { !it.getBoolean("remote") && it.getString("name") == name }
      val plan = call("switchPlan", "target" to target.getString("oid")) as JSONObject
      call("applyWorktree", "changes" to plan.getJSONArray("changes"))
      val index = call("index") as JSONObject
      val next = plan.getJSONObject("index")
      val update = JSONObject()
      (index.keys().asSequence().toList() + next.keys().asSequence().toList()).distinct().forEach { path -> update.put(path, next.opt(path) ?: JSONObject.NULL) }
      call("setIndex", "entries" to update)
      val head = info.getJSONObject("head")
      call("changeHead", "before" to JSONObject().put("branch", head.get("branch")).put("oid", head.get("oid")), "after" to JSONObject().put("branch", name).put("oid", target.getString("oid")))
    }
    checkout("feature")
    assertEquals("feature", call("branch"))
    checkout("main")
    call("branchDelete", "name" to "feature")
    call("tagCreate", "name" to "v1")
    assertEquals("v1", (call("overview") as JSONObject).getJSONArray("tags").getJSONObject(0).getString("name"))
    call("tagDelete", "name" to "v1")
    val invalid = JSONObject(runner.execute(projectId, UUID.randomUUID().toString(), JSONObject().put("method", "commitSnapshot").put("snapshot", snapshot).put("expectedHead", first).put("message", "stale").toString()) { _, _, _, _ -> })
    assertFalse(invalid.getBoolean("ok"))
    assertEquals("CONFLICT", invalid.getString("code"))
    runner.close()
  }
}
