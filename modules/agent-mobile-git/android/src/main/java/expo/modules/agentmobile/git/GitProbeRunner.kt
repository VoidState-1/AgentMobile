package expo.modules.agentmobile.git

import android.content.Context
import java.io.File
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

/** This facade can only create isolated fixtures, never open application projects. */
internal class GitProbeRunner(private val context: Context) {
  private val jobs = ConcurrentHashMap<String, GitJob>()

  fun run(runId: String, phase: String, remoteUrl: String, progress: (String, Int, Int, Long) -> Unit): String {
    require(BuildConfig.DEBUG) { "Git probe is development-only" }
    require(Regex("[a-zA-Z0-9-]{1,64}").matches(runId)) { "Invalid probe runId" }
    require(phase in setOf("local", "https", "cancel", "prepare-restart", "resume-restart")) { "Invalid phase" }
    if (phase == "https" || phase == "cancel") {
      val remote = URI(remoteUrl)
      require(remote.scheme == "https" && !remote.host.isNullOrBlank() && remote.rawUserInfo == null &&
        remote.rawQuery == null && remote.rawFragment == null) { "Public HTTPS URL required; credentials are not accepted" }
    }
    val parent = File(context.cacheDir, "agent-mobile-git-probes").canonicalFile
    val root = File(parent, runId).canonicalFile
    require(root.parentFile == parent) { "Invalid probe directory" }
    val job = GitJob(progress)
    check(jobs.putIfAbsent(runId, job) == null) { "Probe is already running" }
    try {
      root.mkdirs()
      val report = NativeGit.run(root.path, phase, remoteUrl, job).toString(Charsets.UTF_8)
      File(root, "$phase.json").writeText(report)
      return report
    } finally {
      jobs.remove(runId, job)
      job.close()
    }
  }

  fun cancel(runId: String) { jobs[runId]?.cancel() }
  fun close() { jobs.values.forEach { it.cancel() } }
}
