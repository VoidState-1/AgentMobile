package expo.modules.agentmobile.git

import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class GitProbeTest {
  @Test fun validation() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val args = InstrumentationRegistry.getArguments()
    val phase = args.getString("phase") ?: "local"
    val runId = args.getString("runId") ?: "instrumentation"
    val remote = args.getString("remote") ?: "https://github.com/octocat/Hello-World.git"
    val context = instrumentation.targetContext
    val runner = GitProbeRunner(context)
    var events = 0
    var transferEvents = 0
    val report = runner.run(runId, phase, remote) { name, _, _, bytes ->
      events++
      if (name == "transfer") {
        transferEvents++
        if (phase == "cancel" && bytes > 0) runner.cancel(runId)
      }
    }
    val result = JSONObject(report)
    result.put("progressEvents", events)
    result.put("transferEvents", transferEvents)
    result.put("peakRssKb", File("/proc/self/status").readLines().firstOrNull { it.startsWith("VmHWM:") }?.trim())
    instrumentation.sendStatus(2, Bundle().apply { putString("gitReport", result.toString()) })
    assertEquals("1.9.7", NativeGit.version())
    assertTrue(report, result.getBoolean("ok"))
    assertTrue("No native progress callbacks", events > 0)
    if (phase == "https" || phase == "cancel") assertTrue("No transfer progress", transferEvents > 0)
    runner.close()
  }

  @Test fun rejectsUntrustedInputs() {
    val runner = GitProbeRunner(InstrumentationRegistry.getInstrumentation().targetContext)
    for ((runId, phase, remote) in listOf(
      Triple("../escape", "local", ""),
      Triple("bad-url", "https", "http://example.com/repo.git"),
      Triple("credentials", "https", "https://user:secret@example.com/repo.git"),
      Triple("query", "https", "https://example.com/repo.git?token=secret"),
      Triple("phase", "unknown", ""),
    )) {
      try { runner.run(runId, phase, remote) { _, _, _, _ -> }; fail("Untrusted probe input accepted") }
      catch (_: IllegalArgumentException) { /* Expected before any native or network access. */ }
    }
  }

  @Test fun rejectsUntrustedCertificate() {
    val runner = GitProbeRunner(InstrumentationRegistry.getInstrumentation().targetContext)
    val runId = "untrusted-" + System.currentTimeMillis()
    val report = runner.run(runId, "https", "https://self-signed.badssl.com/repo.git") { _, _, _, _ -> }
    val result = JSONObject(report)
    assertFalse("Untrusted TLS server accepted", result.getBoolean("ok"))
    assertTrue(report, result.getString("error").contains("SSLHandshakeException"))
  }
}
