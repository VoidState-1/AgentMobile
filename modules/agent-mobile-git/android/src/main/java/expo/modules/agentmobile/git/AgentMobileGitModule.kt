package expo.modules.agentmobile.git

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors

class AgentMobileGitModule : Module() {
  private val executor = Executors.newFixedThreadPool(4)
  private val runnerDelegate = lazy { GitProbeRunner(appContext.reactContext ?: throw Exceptions.AppContextLost()) }
  private val runner by runnerDelegate
  private val repositoryDelegate = lazy { GitRepositoryRunner(appContext.persistentFilesDirectory, appContext.cacheDirectory) }
  private val repository by repositoryDelegate

  override fun definition() = ModuleDefinition {
    Name("AgentMobileGit")
    Events("onProgress")
    AsyncFunction("version") { NativeGit.version() }
    AsyncFunction("execute") { projectId: String, operationId: String, request: String, promise: Promise ->
      executor.execute {
        try {
          promise.resolve(repository.execute(projectId, operationId, request) { phase, done, total, bytes ->
            sendEvent("onProgress", mapOf("runId" to operationId, "phase" to phase,
              "completed" to done, "total" to total, "bytes" to bytes))
          })
        } catch (error: Exception) { promise.reject("GIT", "原生 Git 操作失败", error) }
      }
    }
    Function("cancel") { operationId: String ->
      repository.cancel(operationId)
      if (runnerDelegate.isInitialized()) runner.cancel(operationId)
    }
    if (BuildConfig.DEBUG) {
      AsyncFunction("probe") { runId: String, phase: String, remoteUrl: String, promise: Promise ->
        executor.execute {
          try {
            val result = runner.run(runId, phase, remoteUrl) { stage, done, total, bytes ->
              sendEvent("onProgress", mapOf("runId" to runId, "phase" to stage,
                "completed" to done, "total" to total, "bytes" to bytes))
            }
            promise.resolve(result)
          } catch (error: Exception) {
            promise.reject("GIT_PROBE", "Native Git validation failed", error)
          }
        }
      }
    }
    OnDestroy {
      if (runnerDelegate.isInitialized()) runner.close()
      if (repositoryDelegate.isInitialized()) repository.close()
      executor.shutdownNow()
    }
  }
}
