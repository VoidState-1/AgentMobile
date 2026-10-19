package expo.modules.agentmobile.git

import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class GitMergeTest {
  private class Fixture : AutoCloseable {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val runner = GitRepositoryRunner(context.filesDir)
    val id = "merge-" + UUID.randomUUID()
    val directory = File(context.filesDir, "agent-mobile/workspaces/$id/repository")
    init { call("init") }
    fun request(method: String, vararg args: Pair<String, Any?>): JSONObject {
      val value = JSONObject().put("method", method); args.forEach { (key, entry) -> value.put(key, entry ?: JSONObject.NULL) }
      return JSONObject(runner.execute(id, UUID.randomUUID().toString(), value.toString()) { _, _, _, _ -> })
    }
    fun call(method: String, vararg args: Pair<String, Any?>): Any {
      val result = request(method, *args); assertTrue(method + ": " + result, result.getBoolean("ok")); return result.get("value")
    }
    fun blob(text: String) = call("writeBlob", "bytes" to Base64.encodeToString(text.toByteArray(), Base64.NO_WRAP)) as String
    fun entry(text: String, mode: Int = 33188) = JSONObject().put("revision", blob(text)).put("mode", mode)
    fun commit(paths: List<String>, message: String) = call("commit", "paths" to JSONArray(paths), "message" to message) as String
    fun snapshot(tree: JSONObject, parent: String) = call("checkpoint", "files" to tree, "parent" to parent, "key" to "fixtures/" + UUID.randomUUID()) as String
    fun replaceIndex(next: JSONObject, conflicts: JSONArray) {
      val current = (call("indexState") as JSONObject).getJSONObject("entries")
      val changes = JSONObject()
      (current.keys().asSequence().toList() + next.keys().asSequence().toList()).distinct().forEach { path -> changes.put(path, next.opt(path) ?: JSONObject.NULL) }
      call("setIndexState", "entries" to changes, "beforeConflicts" to (call("indexState") as JSONObject).getJSONArray("conflicts"), "afterConflicts" to conflicts)
    }
    override fun close() { runner.close() }
  }
  @Test fun threeWayStagesFiltersAndContinue() = Fixture().use { f ->
    f.directory.resolve(".gitattributes").writeText("a.txt text eol=crlf\n")
    f.directory.resolve("a.txt").writeText("base\r\n")
    f.directory.resolve("data.bin").writeBytes(byteArrayOf(0, 1))
    android.system.Os.symlink("base-target", f.directory.resolve("link").path)
    val base = f.commit(listOf(".gitattributes", "a.txt", "data.bin", "link"), "base")
    val sourceTree = f.call("tree", "ref" to base) as JSONObject
    sourceTree.put("a.txt", f.entry("theirs\n")); sourceTree.put("data.bin", f.entry("\u0000\u0003")); sourceTree.put("link", f.entry("theirs-target", 40960))
    val source = f.snapshot(sourceTree, base)
    f.directory.resolve("a.txt").writeText("ours\r\n"); f.directory.resolve("data.bin").writeBytes(byteArrayOf(0, 2))
    f.directory.resolve("link").delete(); android.system.Os.symlink("ours-target", f.directory.resolve("link").path)
    val ours = f.commit(listOf("a.txt", "data.bin", "link"), "ours")
    val beforeIndex = f.directory.resolve(".git/index").readBytes()
    val plan = f.call("mergePlan", "target" to source, "message" to "merge fixture") as JSONObject
    assertEquals("conflicts", plan.getString("kind"))
    assertArrayEquals(beforeIndex, f.directory.resolve(".git/index").readBytes())
    assertEquals("ours\r\n", f.directory.resolve("a.txt").readText())
    assertFalse(f.directory.resolve(".git/MERGE_HEAD").exists())
    val index = plan.getJSONObject("index"); assertEquals(3, index.getJSONArray("conflicts").length())
    f.call("applyWorktree", "changes" to plan.getJSONArray("changes"))
    assertTrue(f.directory.resolve("a.txt").readText().contains("<<<<<<< ours"))
    assertTrue("CRLF smudge was lost", f.directory.resolve("a.txt").readText().contains("\r\n"))
    f.replaceIndex(index.getJSONObject("entries"), index.getJSONArray("conflicts"))
    val beforeState = f.call("gitState") as JSONObject
    f.directory.resolve(".git/.agent-mobile-state-MERGE_MSG-AbC123").writeText("interrupted state write")
    f.call("applyGitState", "before" to beforeState, "after" to plan.getJSONObject("stateAfter"))
    assertFalse(f.directory.resolve(".git/.agent-mobile-state-MERGE_MSG-AbC123").exists())
    assertEquals("merge", (f.call("overview") as JSONObject).getString("state"))
    val actual = f.call("indexState") as JSONObject
    assertEquals(index.getJSONArray("conflicts").toString(), actual.getJSONArray("conflicts").toString())
    f.directory.resolve("a.txt").writeText("resolved\r\n")
    val raw = f.call("workingTree") as JSONObject; val attrs = f.snapshot(raw, ours)
    val cleaned = f.call("filterEntries", "entries" to JSONObject().put("a.txt", raw.getJSONObject("a.txt")), "attributes" to attrs, "direction" to "clean") as JSONObject
    val contents = f.call("blob", "oid" to cleaned.getJSONObject("a.txt").getString("revision")) as String
    assertEquals("resolved\n", String(Base64.decode(contents, Base64.DEFAULT)))
    val resolved = index.getJSONObject("entries")
    resolved.put("a.txt", cleaned.getJSONObject("a.txt"))
    val oursTree = f.call("tree", "ref" to ours) as JSONObject
    resolved.put("data.bin", oursTree.getJSONObject("data.bin")); resolved.put("link", oursTree.getJSONObject("link"))
    f.replaceIndex(resolved, JSONArray())
    val merged = f.call("mergeCommit", "entries" to resolved, "parents" to JSONArray(listOf(ours, source)), "message" to "merge completed") as String
    assertEquals(ours, f.call("head"))
    val state = f.call("gitState") as JSONObject
    val cleared = JSONObject(state.toString()).put("MERGE_HEAD", JSONObject.NULL).put("MERGE_MSG", JSONObject.NULL).put("MERGE_MODE", JSONObject.NULL)
    f.directory.resolve(".git/MERGE_MODE").delete() // Process stopped between metadata fields.
    f.call("applyGitState", "before" to state, "after" to cleared)
    f.call("changeHead", "before" to JSONObject().put("branch", "main").put("oid", ours), "after" to JSONObject().put("branch", "main").put("oid", merged))
    val parents = (f.call("history") as JSONObject).getJSONArray("versions").getJSONObject(0).getJSONArray("parents")
    assertEquals(JSONArray(listOf(ours, source)).toString(), parents.toString())
    assertEquals("none", (f.call("status") as JSONObject).getString("state"))
    assertEquals(0, (f.call("status") as JSONObject).getJSONArray("files").length())
    val receipt = f.snapshot(f.call("workingTree") as JSONObject, merged)
    f.call("completeOperation", "operationId" to "merge-completion", "checkpoint" to receipt)
    assertEquals(receipt, f.call("operationReceipt", "operationId" to "merge-completion"))
    f.call("completeOperation", "operationId" to "merge-completion", "checkpoint" to receipt)
    Unit
  }
  @Test fun directoryFileConflictUsesLibgitCheckout() = Fixture().use { f ->
    f.directory.resolve("base.txt").writeText("base")
    val base = f.commit(listOf("base.txt"), "base")
    val tree = f.call("tree", "ref" to base) as JSONObject
    tree.put("shape/nested.txt", f.entry("theirs directory"))
    val source = f.snapshot(tree, base)
    f.directory.resolve("shape").writeText("ours file")
    f.commit(listOf("shape"), "ours")
    val plan = f.call("mergePlan", "target" to source, "message" to "directory conflict") as JSONObject
    assertEquals("conflicts", plan.getString("kind"))
    assertEquals("ours file", f.directory.resolve("shape").readText())
    f.call("applyWorktree", "changes" to plan.getJSONArray("changes"))
    f.replaceIndex(plan.getJSONObject("index").getJSONObject("entries"), plan.getJSONObject("index").getJSONArray("conflicts"))
    assertEquals("theirs directory", f.directory.resolve("shape/nested.txt").readText())
    assertTrue(f.directory.listFiles()!!.any { it.name.startsWith("shape~") && it.readText() == "ours file" })
    assertTrue((f.call("indexState") as JSONObject).getJSONArray("conflicts").length() > 0)
  }
  @Test fun cleanMergeIsPreparedWithoutMovingHead() = Fixture().use { f ->
    f.directory.resolve("a.txt").writeText("base-a"); f.directory.resolve("b.txt").writeText("base-b")
    val base = f.commit(listOf("a.txt", "b.txt"), "base")
    val tree = f.call("tree", "ref" to base) as JSONObject; tree.put("b.txt", f.entry("theirs-b")); val source = f.snapshot(tree, base)
    f.directory.resolve("a.txt").writeText("ours-a"); val ours = f.commit(listOf("a.txt"), "ours")
    val plan = f.call("mergePlan", "target" to source, "message" to "clean merge") as JSONObject
    assertEquals("merged", plan.getString("kind")); assertEquals(ours, f.call("head")); assertEquals("base-b", f.directory.resolve("b.txt").readText())
    val merged = plan.getJSONObject("headAfter").getString("oid")
    assertEquals(2, (f.call("history", "query" to JSONObject().put("head", merged)) as JSONObject).getJSONArray("versions").getJSONObject(0).getJSONArray("parents").length())
  }
  @Test fun attributesComeFromMergedTree() = Fixture().use { f ->
    f.directory.resolve(".gitattributes").writeText("*.txt text eol=lf\n")
    f.directory.resolve("a.txt").writeText("base-a\n"); f.directory.resolve("b.txt").writeText("base-b\n")
    val base = f.commit(listOf(".gitattributes", "a.txt", "b.txt"), "base")
    val tree = f.call("tree", "ref" to base) as JSONObject
    tree.put(".gitattributes", f.entry("*.txt text eol=crlf\n")); tree.put("b.txt", f.entry("theirs-b\n"))
    val source = f.snapshot(tree, base)
    f.directory.resolve("a.txt").writeText("ours-a\n"); f.commit(listOf("a.txt"), "ours")
    val plan = f.call("mergePlan", "target" to source, "message" to "new attributes") as JSONObject
    assertEquals("merged", plan.getString("kind"))
    assertEquals("ours-a\n", f.directory.resolve("a.txt").readText())
    f.call("applyWorktree", "changes" to plan.getJSONArray("changes"))
    assertEquals("ours-a\r\n", f.directory.resolve("a.txt").readText())
    assertEquals("theirs-b\r\n", f.directory.resolve("b.txt").readText())
  }
  @Test fun fastForwardUnbornAndUnrelatedHistories() = Fixture().use { f ->
    val source = f.call("checkpoint", "files" to JSONObject().put("first.txt", f.entry("first")), "parent" to "", "key" to "unborn-source") as String
    val initial = f.call("mergePlan", "target" to source, "message" to "first merge") as JSONObject
    assertEquals("fast-forward", initial.getString("kind")); assertEquals(JSONObject.NULL, f.call("head"))
    f.call("applyWorktree", "changes" to initial.getJSONArray("changes"))
    f.replaceIndex(initial.getJSONObject("index").getJSONObject("entries"), JSONArray())
    f.call("changeHead", "before" to JSONObject().put("branch", "main").put("oid", JSONObject.NULL), "after" to initial.getJSONObject("headAfter"))
    assertEquals("up-to-date", (f.call("mergePlan", "target" to source, "message" to "repeat") as JSONObject).getString("kind"))
    val nextTree = f.call("tree", "ref" to source) as JSONObject
    nextTree.put("second.txt", f.entry("second")); val next = f.snapshot(nextTree, source)
    assertEquals("fast-forward", (f.call("mergePlan", "target" to next, "message" to "forward") as JSONObject).getString("kind"))
    val unrelated = f.call("checkpoint", "files" to JSONObject().put("other.txt", f.entry("other")), "parent" to "", "key" to "unrelated-source") as String
    val refused = f.request("mergePlan", "target" to unrelated, "message" to "unrelated")
    assertFalse(refused.getBoolean("ok")); assertEquals("VALIDATION", refused.getString("code"))
    assertEquals(source, f.call("head")); assertFalse(f.directory.resolve(".git/MERGE_HEAD").exists())
  }
  @Test fun renameAndDeleteModifyStagesSurviveSerialization() = Fixture().use { f ->
    f.directory.resolve("old.txt").writeText("rename body\n"); f.directory.resolve("delete.txt").writeText("base delete\n")
    val base = f.commit(listOf("old.txt", "delete.txt"), "base")
    val incoming = f.call("tree", "ref" to base) as JSONObject
    incoming.put("incoming.txt", incoming.remove("old.txt")); incoming.remove("delete.txt")
    val source = f.snapshot(incoming, base)
    f.directory.resolve("old.txt").renameTo(f.directory.resolve("current.txt")); f.directory.resolve("delete.txt").writeText("ours modification\n")
    val ours = f.commit(listOf("old.txt", "current.txt", "delete.txt"), "ours")
    val plan = f.call("mergePlan", "target" to source, "message" to "rename and delete") as JSONObject
    assertEquals("conflicts", plan.getString("kind"))
    val expected = plan.getJSONObject("index"); val conflicts = expected.getJSONArray("conflicts")
    assertTrue(conflicts.length() >= 2)
    f.call("applyWorktree", "changes" to plan.getJSONArray("changes"))
    f.replaceIndex(expected.getJSONObject("entries"), conflicts)
    assertEquals(conflicts.toString(), (f.call("indexState") as JSONObject).getJSONArray("conflicts").toString())
    f.replaceIndex(f.call("tree", "ref" to ours) as JSONObject, JSONArray())
    assertEquals(0, (f.call("indexState") as JSONObject).getJSONArray("conflicts").length())
    assertEquals(2, (f.call("index") as JSONObject).length())
    assertEquals(ours, f.call("head"))
  }
  @Test fun executableModeAndSpecialFileNames() = Fixture().use { f ->
    f.directory.resolve("constructor").writeText("base\n"); f.directory.resolve("toString").writeText("unchanged\n")
    val base = f.commit(listOf("constructor", "toString"), "base")
    val incoming = f.call("tree", "ref" to base) as JSONObject
    incoming.put("__proto__", f.entry("incoming\n")); incoming.put("constructor", f.entry("base\n", 33261))
    val source = f.snapshot(incoming, base)
    f.directory.resolve("constructor").writeText("ours\n"); f.commit(listOf("constructor"), "ours")
    val plan = f.call("mergePlan", "target" to source, "message" to "mode merge") as JSONObject
    assertEquals("merged", plan.getString("kind"))
    val entries = plan.getJSONObject("index").getJSONObject("entries")
    assertEquals(33261, entries.getJSONObject("constructor").getInt("mode"))
    f.call("applyWorktree", "changes" to plan.getJSONArray("changes"))
    assertEquals("ours\n", f.directory.resolve("constructor").readText()); assertTrue(f.directory.resolve("constructor").canExecute())
    assertEquals("incoming\n", f.directory.resolve("__proto__").readText())
  }
}
