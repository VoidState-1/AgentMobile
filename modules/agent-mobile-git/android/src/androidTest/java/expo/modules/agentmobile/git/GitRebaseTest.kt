package expo.modules.agentmobile.git

import android.util.Base64
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class GitRebaseTest {
  private class Fixture : AutoCloseable {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    var runner = GitRepositoryRunner(context.filesDir)
    val id = "rebase-" + UUID.randomUUID()
    val directory = File(context.filesDir, "agent-mobile/workspaces/$id/repository")
    init { call("init") }
    fun request(method: String, vararg args: Pair<String, Any?>): JSONObject {
      val value = JSONObject().put("method", method)
      args.forEach { (key, entry) -> value.put(key, entry ?: JSONObject.NULL) }
      return JSONObject(runner.execute(id, UUID.randomUUID().toString(), value.toString()) { _, _, _, _ -> })
    }
    fun call(method: String, vararg args: Pair<String, Any?>): Any {
      val result = request(method, *args); assertTrue(method + ": " + result, result.getBoolean("ok")); return result.get("value")
    }
    fun entry(text: String): JSONObject {
      val oid = call("writeBlob", "bytes" to Base64.encodeToString(text.toByteArray(), Base64.NO_WRAP)) as String
      return JSONObject().put("revision", oid).put("mode", 33188)
    }
    fun commit(paths: List<String>, message: String) = call("commit", "paths" to JSONArray(paths), "message" to message) as String
    fun snapshot(tree: JSONObject, parent: String) = call("checkpoint", "files" to tree, "parent" to parent, "key" to "fixture/" + UUID.randomUUID()) as String
    fun replaceIndex(next: JSONObject, conflicts: JSONArray = JSONArray()) {
      val actual = call("indexState") as JSONObject; val old = actual.getJSONObject("entries"); val updates = JSONObject()
      (old.keys().asSequence().toList() + next.keys().asSequence().toList()).distinct().forEach { path -> updates.put(path, next.opt(path) ?: JSONObject.NULL) }
      call("setIndexState", "entries" to updates, "beforeConflicts" to actual.getJSONArray("conflicts"), "afterConflicts" to conflicts)
    }
    fun ref(oid: String, branch: String? = null) = JSONObject().put("oid", oid).put("branch", branch ?: JSONObject.NULL)
    fun begin(original: String, onto: String, todo: List<String>) {
      val plan = call("switchPlan", "target" to onto) as JSONObject
      call("applyWorktree", "changes" to plan.getJSONArray("changes")); replaceIndex(plan.getJSONObject("index"))
      val before = call("gitState") as JSONObject
      val after = JSONObject(before.toString()).put("ORIG_HEAD", original + "\n")
        .put("rebase-merge/interactive", "").put("rebase-merge/head-name", "refs/heads/main\n")
        .put("rebase-merge/orig-head", original + "\n").put("rebase-merge/onto", onto + "\n")
        .put("rebase-merge/git-rebase-todo", todo.joinToString("") { "pick $it\n" })
        .put("rebase-merge/done", "").put("rebase-merge/end", todo.size.toString() + "\n").put("rebase-merge/msgnum", "0\n")
      call("applyGitState", "before" to before, "after" to after)
      call("changeHead", "before" to ref(original, "main"), "after" to ref(onto))
    }
    override fun close() { runner.close() }
  }
  @Test fun memoryPlanAndReplayPreserveAuthorAndMessage() = Fixture().use { f ->
    f.directory.resolve("a.txt").writeText("base-a\n"); f.directory.resolve("b.txt").writeText("base-b\n")
    val base = f.commit(listOf("a.txt", "b.txt"), "base")
    val target = f.call("tree", "ref" to base) as JSONObject; target.put("b.txt", f.entry("onto-b\n")); val onto = f.snapshot(target, base)
    f.call("identity", "name" to "Original Author", "email" to "original@example.invalid")
    f.directory.resolve("a.txt").writeText("first-a\n"); val first = f.commit(listOf("a.txt"), "first authored\n\nbody")
    f.directory.resolve("c.txt").writeText("second-c\n"); val original = f.commit(listOf("c.txt"), "second authored")
    val oldIndex = f.directory.resolve(".git/index").readBytes()
    val plan = f.call("rebasePlan", "target" to onto) as JSONObject
    assertEquals("replay", plan.getString("kind")); val commits = plan.getJSONArray("commits")
    assertEquals(first, commits.getJSONObject(0).getString("oid")); assertEquals(original, commits.getJSONObject(1).getString("oid"))
    assertEquals("first authored\n\nbody", commits.getJSONObject(0).getString("message"))
    assertArrayEquals(oldIndex, f.directory.resolve(".git/index").readBytes()); assertEquals(original, f.call("head")); assertFalse(f.directory.resolve(".git/rebase-merge").exists())
    f.begin(original, onto, listOf(first, original))
    f.call("identity", "name" to "New Committer", "email" to "new@example.invalid")
    var current = onto
    for (old in listOf(first, original)) {
      val step = f.call("rebaseStep", "commit" to old, "current" to current) as JSONObject
      assertEquals(0, step.getJSONObject("index").getJSONArray("conflicts").length())
      f.call("applyWorktree", "changes" to step.getJSONArray("changes")); f.replaceIndex(step.getJSONObject("index").getJSONObject("entries"))
      val next = f.call("rebaseCommit", "entries" to step.getJSONObject("index").getJSONObject("entries"), "original" to old, "parent" to current) as String
      f.call("changeHead", "before" to f.ref(current), "after" to f.ref(next)); current = next
    }
    val guard = JSONObject().put("name", "main").put("oid", original)
    // The branch CAS finished, but the process stopped before attaching HEAD.
    f.directory.resolve(".git/refs/heads/main").writeText(current + "\n")
    f.call("changeHead", "before" to f.ref(current), "after" to f.ref(current, "main"), "branchGuard" to guard)
    val versions = (f.call("history") as JSONObject).getJSONArray("versions")
    assertEquals("Original Author", versions.getJSONObject(0).getJSONObject("author").getString("name"))
    assertEquals("New Committer", versions.getJSONObject(0).getJSONObject("committer").getString("name"))
    assertEquals("second authored", versions.getJSONObject(0).getString("message"))
    assertEquals("onto-b\n", f.directory.resolve("b.txt").readText()); assertEquals("second-c\n", f.directory.resolve("c.txt").readText())
  }
  @Test fun conflictsAndPartialStateSurviveRunnerRestart() = Fixture().use { f ->
    f.directory.resolve(".gitattributes").writeText("*.txt text eol=crlf\n"); f.directory.resolve("a.txt").writeText("base\r\n")
    val base = f.commit(listOf(".gitattributes", "a.txt"), "base")
    val target = f.call("tree", "ref" to base) as JSONObject; target.put("a.txt", f.entry("onto\n")); val onto = f.snapshot(target, base)
    f.directory.resolve("a.txt").writeText("ours\r\n"); val original = f.commit(listOf("a.txt"), "ours")
    f.begin(original, onto, listOf(original))
    val step = f.call("rebaseStep", "commit" to original, "current" to onto) as JSONObject
    assertEquals("onto\r\n", f.directory.resolve("a.txt").readText())
    val state = step.getJSONObject("index"); assertEquals(1, state.getJSONArray("conflicts").length())
    f.call("applyWorktree", "changes" to step.getJSONArray("changes")); f.replaceIndex(state.getJSONObject("entries"), state.getJSONArray("conflicts"))
    assertTrue(f.directory.resolve("a.txt").readText().contains("\r\n"))
    val before = f.call("gitState") as JSONObject
    val after = JSONObject(before.toString()).put("REBASE_HEAD", original + "\n").put("rebase-merge/stopped-sha", original + "\n").put("rebase-merge/message", "ours")
    f.directory.resolve(".git/REBASE_HEAD").writeText(original + "\n")
    f.directory.resolve(".git/rebase-merge/.agent-mobile-state-message-ABC123").writeText("part")
    f.runner.close(); f.runner = GitRepositoryRunner(f.context.filesDir)
    f.call("applyGitState", "before" to before, "after" to after)
    assertFalse(f.directory.resolve(".git/rebase-merge/.agent-mobile-state-message-ABC123").exists())
    assertEquals("rebase", (f.call("overview") as JSONObject).getString("state"))
    assertEquals(state.getJSONArray("conflicts").toString(), (f.call("indexState") as JSONObject).getJSONArray("conflicts").toString())
  }
  @Test fun branchGuardRefusesExternalChangeAndStateRejectsSymlinks() = Fixture().use { f ->
    f.directory.resolve("a.txt").writeText("base"); val base = f.commit(listOf("a.txt"), "base")
    val tree = f.call("tree", "ref" to base) as JSONObject; tree.put("new.txt", f.entry("new")); val next = f.snapshot(tree, base)
    f.call("changeHead", "before" to f.ref(base, "main"), "after" to f.ref(next))
    f.directory.resolve(".git/refs/heads/main").writeText(next + "\n")
    val refused = f.request("changeHead", "before" to f.ref(next), "after" to f.ref(base, "main"), "branchGuard" to JSONObject().put("name", "main").put("oid", base))
    assertFalse(refused.getBoolean("ok")); assertEquals("CONFLICT", refused.getString("code")); assertEquals(JSONObject.NULL, f.call("branch"))
    f.directory.resolve(".git/rebase-merge").mkdir()
    android.system.Os.symlink(f.directory.resolve("a.txt").path, f.directory.resolve(".git/rebase-merge/message").path)
    assertFalse(f.request("gitState").getBoolean("ok")); assertEquals("base", f.directory.resolve("a.txt").readText())
  }
  @Test fun redundantChangesAreDroppedButOriginallyEmptyCommitsRemain() = Fixture().use { f ->
    f.directory.resolve("a.txt").writeText("base\n"); val base = f.commit(listOf("a.txt"), "base")
    val baseTree = f.call("tree", "ref" to base) as JSONObject
    val empty = f.call("commitSnapshot", "snapshot" to f.snapshot(baseTree, base), "expectedHead" to base, "message" to "empty kept") as String
    f.directory.resolve("a.txt").writeText("change\n"); val original = f.commit(listOf("a.txt"), "change")
    val target = f.call("tree", "ref" to original) as JSONObject; target.put("onto.txt", f.entry("onto\n")); val onto = f.snapshot(target, base)
    assertEquals(JSONObject.NULL, f.call("rebaseCommit", "entries" to target, "original" to original, "parent" to onto))
    val kept = f.call("rebaseCommit", "entries" to target, "original" to empty, "parent" to onto) as String
    val top = (f.call("history", "query" to JSONObject().put("head", kept)) as JSONObject).getJSONArray("versions").getJSONObject(0)
    assertEquals("empty kept", top.getString("message")); assertEquals(onto, top.getJSONArray("parents").getString(0)); assertEquals(original, f.call("head"))
  }
  @Test fun normalizedBytesAreAcceptedAndUnrelatedUserEditsArePreserved() = Fixture().use { f ->
    f.directory.resolve(".gitattributes").writeText("*.txt text eol=lf\n")
    f.directory.resolve("a.txt").writeText("base-a\n"); f.directory.resolve("b.txt").writeText("base-b\n")
    val base = f.commit(listOf(".gitattributes", "a.txt", "b.txt"), "base")
    val target = f.call("tree", "ref" to base) as JSONObject; target.put("b.txt", f.entry("target-b\n")); val onto = f.snapshot(target, base)
    f.directory.resolve("a.txt").writeText("replayed-a\n"); val original = f.commit(listOf("a.txt"), "replay")
    f.begin(original, onto, listOf(original))
    f.directory.resolve("a.txt").writeText("base-a\r\n"); f.directory.resolve("b.txt").writeText("unrelated user edit\n")
    val step = f.call("rebaseStep", "commit" to original, "current" to onto) as JSONObject
    assertEquals(1, step.getJSONArray("changes").length()); assertEquals("a.txt", step.getJSONArray("changes").getJSONObject(0).getString("path"))
    f.directory.resolve("a.txt").writeText("actual user edit\n")
    val refused = f.request("rebaseStep", "commit" to original, "current" to onto)
    assertFalse(refused.getBoolean("ok")); assertEquals("CONFLICT", refused.getString("code"))
    f.directory.resolve("a.txt").writeText("base-a\r\n")
    f.call("applyWorktree", "changes" to step.getJSONArray("changes"))
    assertEquals("replayed-a\n", f.directory.resolve("a.txt").readText()); assertEquals("unrelated user edit\n", f.directory.resolve("b.txt").readText())
  }
}
