import ExpoModulesCore

public class AgentMobileGitModule: Module {
  private let runner = AMGitProbeRunner()
  private let queue = DispatchQueue(label: "com.agentmobile.git.probe", qos: .utility)

  public func definition() -> ModuleDefinition {
    Name("AgentMobileGit")
    Events("onProgress")
    AsyncFunction("version") { self.runner.version() }
    AsyncFunction("execute") { (projectId: String, operationId: String, request: String) throws -> String in
      try self.runner.execute(projectId, operationId: operationId, request: request) { phase, done, total, bytes in
        self.sendEvent("onProgress", ["runId": operationId, "phase": phase,
          "completed": done, "total": total, "bytes": bytes])
      }
    }.runOnQueue(queue)
    Function("cancel") { (runId: String) in self.runner.cancel(runId) }
    #if DEBUG
    AsyncFunction("probe") { (runId: String, phase: String, remoteUrl: String) throws -> String in
      try self.runner.run(runId, phase: phase, remote: remoteUrl) { stage, done, total, bytes in
        self.sendEvent("onProgress", ["runId": runId, "phase": stage,
          "completed": done, "total": total, "bytes": bytes])
      }
    }.runOnQueue(queue)
    #endif
    OnDestroy { self.runner.close() }
  }
}
