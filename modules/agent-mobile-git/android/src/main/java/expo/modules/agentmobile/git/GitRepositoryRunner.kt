package expo.modules.agentmobile.git

import org.json.JSONObject
import android.net.Uri
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** Product repositories are selected by ID; neither JS nor models supply native paths. */
internal class GitRepositoryRunner(private val directory: File, private val cache: File = File(directory.parentFile, "cache")) {
  private val jobs = ConcurrentHashMap<String, GitJob>()
  private val gate = Any()
  private val cancelled = mutableSetOf<String>()
  private var closed = false

  fun execute(projectId: String, operationId: String, request: String, progress: (String, Int, Int, Long) -> Unit): String {
    require(Regex("[a-zA-Z0-9-]{1,80}").matches(projectId)) { "Invalid project ID" }
    require(Regex("[a-zA-Z0-9-]{1,100}").matches(operationId)) { "Invalid operation ID" }
    // /data/user/0 and /data/data may alias the same OS-owned sandbox root.
    val parent = File(directory.canonicalFile, "agent-mobile/workspaces").absoluteFile.normalize()
    val repository = File(parent, "$projectId/repository").absoluteFile.normalize()
    require(repository.canonicalFile == repository && parent.canonicalFile == parent) { "Repository path crosses a symbolic link" }
    val arguments = JSONObject(request).put("projectId", projectId)
      .put("exportDirectory", File(cache.canonicalFile, "agent-mobile-exports/$operationId").path)
    val input = arguments.toString().toByteArray(Charsets.UTF_8)
    val job = GitJob(progress)
    synchronized(gate) {
      check(jobs.putIfAbsent(operationId, job) == null) { "Git operation is already running" }
      if (closed || cancelled.remove(operationId)) job.cancel()
    }
    try {
      return run {
        val response = NativeGit.execute(repository.path, input, job).toString(Charsets.UTF_8)
        if (arguments.optString("method") == "fileExport") {
          val result = JSONObject(response)
          if (result.getBoolean("ok")) result.put("value", Uri.fromFile(File(result.getString("value"))).toString())
          result.toString()
        } else response
      }
    } finally { synchronized(gate) { jobs.remove(operationId, job) }; job.close() }
  }
  fun cancel(operationId: String) { synchronized(gate) {
    val job = jobs[operationId]
    if (job != null) job.cancel() else if (!closed) cancelled.add(operationId)
  } }
  fun close() { synchronized(gate) { closed = true; cancelled.clear(); jobs.values.forEach { it.cancel() } } }
}
