# 应用接口契约

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                                              |
| -------- | ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| 4.3.0    | 2026-10-19T17:56:09+08:00 | 414863fdcd788534b2232fea740024864a8726a4 | 对应已提交源码：明确保留的 Git/HTTPS/合并/变基接口，清除范围外高级操作接口。          |
| 4.2.0    | 2026-10-19T15:27:13+08:00 | 262940983352666ec86b8389fc656ed368f5680d | 同步尚未提交源码：变基开始/继续/跳过/中止与 session 投影，冲突接口支持 merge/rebase。 |
| 4.1.0    | 2026-10-19T14:43:24+08:00 | 262940983352666ec86b8389fc656ed368f5680d | 同步尚未提交源码：合并、三方预览、冲突解决、继续/中止与会话投影。                     |
| 4.0.0    | 2026-10-19T12:10:29+08:00 | 262940983352666ec86b8389fc656ed368f5680d | 同步尚未提交源码：仓库管理、克隆、传输观察与取消、凭证入口、null HEAD 和文件模式。    |
| 2.5.0    | 2026-10-18T19:00:33+08:00 | 34f542b6f4e917f475d36c9f5ea8b369f5d74dda | 同步尚未提交源码：增加文件草稿查询/CAS 保存与 writeText 稳定操作 ID。                 |
| 3.0.0    | 2026-10-17T10:27:05+08:00 | ba5117e2ea7908376dec70267b60d3b5d95f5156 | 同步尚未提交源码：writeText、原始字节 write、内容类型与不可预览差异契约。             |
| 2.2.0    | 2026-10-17T00:09:49+08:00 | fd29c75e38d245b3a8e5cfb6a93c0b2156029d22 | 同步尚未提交源码：区分 Agent editText 内部用例和界面全文保存接口。                    |
| 2.1.0    | 2026-10-16T23:47:05+08:00 | c6cde1a9724a790e02cbe4488d7e00542d5e1d76 | 同步尚未提交源码：补充通用文本写入、预览、移动和任意类型选择器的校验契约。            |
| 2.0.0    | 2026-10-16T23:27:39+08:00 | 798aea13020fdad314b8a34bc78d7eadb2ac0bf0 | 同步尚未提交源码：删除 setMode，增加带配置修订校验的供应商排序接口。                  |
| 1.2.0    | 2026-10-16T22:42:39+08:00 | 798aea13020fdad314b8a34bc78d7eadb2ac0bf0 | 补充尚未提交源码的 prepareIcon、连接 icon 和图片选择参数。                            |
| 1.1.0    | 2026-10-16T15:39:09+08:00 | d409b141eeeb219779697a62544c17ea23288a12 | 记录尚未提交源码的 branch、类型化文件状态及 taskChangeSummary 查询。                  |
| 1.0.0    | 2026-10-15T17:24:30+08:00 | 9ad009be8a41df28a02060c5620ee12a29c3d901 | 建立 AppServices 能力目录、DTO、并发预期、错误与变更规范。                            |

## 1. 唯一业务入口

界面使用 [AppServices](../src/application/services.ts)。`getAppServices()` 负责异步初始化并返回进程内共享服务；简单配置页面通过 `useAppServices()` 获取，工作台由 `useWorkbenchData()` 管理启动与订阅。

[facade](../src/bootstrap/facade.ts) 显式选择方法、绑定 `this`、冻结公开对象、处理同步及异步错误。`RunKernel`、`WorkspaceApplication`、底层数据库、GitPort 和 CredentialStore 不直接暴露给 UI。Agent 工具也不能直接拿 AppServices，它们通过应用层构建的受限工具上下文工作。

本文件是使用指南，精确 TypeScript 签名以源码为准。修改接口必须同步修改 facade 和全部调用者，不通过类型断言将多余宿主能力隐藏在类型之外。

## 2. 调用分类

- **查询**：读取当前业务事实；可能异步失败，不能根据 UI 缓存假设查询永远成功。
- **命令**：返回 Promise；成功表示该用例必要回执已完成，返回值未必是公开 Git commit。
- **快照订阅**：`getSnapshot()` 配合 `subscribe()`，供配置或活跃运行视图使用。
- **变更订阅**：Workspace/Run 只发身份与范围事件，收到事件后按当前项目/会话重新查询。事件不是数据库事务，不应作为唯一持久化记录。

所有订阅返回取消函数，页面 effect 清理时调用。观察者异常不能撤销已经完成的持久化操作。

## 3. 能力目录

### 3.1 `workspace`

| 方法组                              | 含义与调用要求                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `projects / create`                 | 列项目、创建项目；普通新建包含初始 notes 和显式初始提交；项目元数据只进业务库  |
| `files / read / preview / head`     | 文件描述、原始 bytes + revision、文本或图片 data URI 预览、公开 HEAD           |
| `snapshot`                          | 一次项目队列中的文件、Git 状态、首批历史、操作摘要与可选打开文件预览           |
| `write / writeText / remove / move` | 使用当前文件 revision；新建写入用 null；移动要求目标不存在                     |
| `status / diff`                     | HEAD/index/worktree 三方状态；staged 为 HEAD→index，unstaged 为 index→worktree |
| `stage`                             | 传 HEAD、indexRevision 以及每个所选路径的内容 revision/null                    |
| `unstage / commitStaged`            | 传当前 HEAD 和 indexRevision；commit 只提交已暂存内容                          |
| `discard`                           | 传完整 GitStatus，回到 index 内容；不会丢弃暂存内容                            |
| `historyPage / restore / changes`   | 历史分页、将历史树写回工作区、两个快照之间的差异                               |
| `taskChanges / undoTask`            | 通过 runId 查看/撤销根任务实际归属变化；有后续修改则拒绝撤销                   |
| `subscribe / recoveryIssues`        | 已记录修改通知、启动恢复问题                                                   |

`workspace.write` 接受原始字节，当前单文件操作预算 20 MiB，不按扩展名或预览能力拒绝存储。`writeText` 用于编辑器和文本工具，要求新旧内容均为有效 UTF-8、无 NUL、最多 1 MiB，防止误覆盖二进制；其他文本编码仍可通过 write 保存及导出。写入共享相同修订、占用、操作日志与恢复语义。move 不解码或转码，改变后缀不会改变字节或实际内容类型。

`ProjectFile` 含 path/revision/mode/size/mimeType 与 `kind: text | image | binary`。类型按字节识别，扩展名仅决定文本是否用 Markdown 排版。`FilePreview` 返回这些内容字段中的 kind/mimeType/size/revision，以及 content 和可选 unavailableReason；可预览文本为原文，图片为 data URI。二进制、超预算文本或无法安全展示的图片返回空 content 和明确原因，不以替换字符解码二进制，也不妨碍 read/export/Git 操作。

Agent 的 edit_text 通过内部 WorkspaceApplication.editText 调用批量替换；它不加入 AppServices.workspace 的 UI API。界面通过 workspace.writeText 保存完整输入，通过 write 导入原始文件。editText 的请求指纹属于操作正文，公开操作摘要不暴露替换输入或完整 before/after；模型工具结果只返回新修订及有界变化预览。

`WorkspaceSnapshot.operations` 只含 ID、归属、阶段和路径摘要，不含文件前后像或内部对象引用正文。`write/remove/move` 返回的字符串可能为内部 checkpoint，无变化时也可能为 HEAD，不能拿它直接渲染“已提交”。公开版本来自 `head/historyPage/commitStaged`。

`workspace.editorDraft(projectId, path)` 返回 revision/draft；`saveEditorDraft(projectId, path, draft|null, expectedRevision)` 在当前服务队列内校验修订，写业务元数据而不写文件。null 清理仍保留修订墓碑，旧异步请求无法复活草稿。EditorDraft format=1 校验完整文本投影、区域、选区、保存意图及路径；不读取历史格式。

`writeText` 的第五个参数允许传入 `{ operationId }`，用于同一文件修改意图的可恢复幂等重试；相同 ID/不同参数仍拒绝。返回字符串依旧是工作区回执/检查点，文件 revision 通过 preview 获取。文件草稿和工作区操作不构成跨存储事务。

### 3.2 仓库管理与传输

`repository(projectId)` 和 snapshot.repository 返回真实引擎/版本、HEAD、分支与上游差距、标签、远程、身份、冲突 stage 描述和 capabilities。原生已开放 clone/fetch/push；Web 远程传输仍为 false。pendingPushes 是需要显式核对的推送，不能按普通网络错误自动重试。

`gitCommand(projectId, command, expectedStatus)` 提供身份、分支创建/切换/删除、标签、远程地址、fetch、push、上游配置与 verifyPush。命令必须携带当前 GitStatus；项目占用、未提交文件及所有持久草稿会保护分支切换。push.branch 是远程目标分支，源提交固定为当前 HEAD，不强推。verifyPush 按 ID 核对同一远程地址的实际分支，更新回执；核对时远程已变化不代表历史推送一定未发生。

`cloneProject({name,url}, credential?)` 下载到未发布目录，成功后注册 Project；不调用普通 create，不加 notes、project.json 或初始提交。中断恢复只处理该次导入的暂存与回执。可选 credential 仅用于本次克隆。

`saveGitCredential(projectId,name,url,{username,token}|null)` 将令牌写入凭证存储，业务库只存用户名、地址和引用。认证绑定具体地址，远程地址改变后不复用。公开 repository 只返回 credentialUsername，不返回令牌。

`gitTransfer(projectId?)` 返回当前进程最近传输状态；省略 ID 返回全局最近事件。`subscribeGitTransfer(listener)` 观察进度，`cancelGitTransfer(projectId)` 可在写队列占用期间同步请求取消。state 为 running/completed/cancelled/failed/unknown；取消推送也可能得到 unknown，因为服务器可能已接受。进度是暂态；待核对推送意图在业务库中持久保存。

`mergeBranch(projectId,{name,oid},expectedStatus)` 核对实际分支引用、完整状态及全部持久草稿，要求工作区干净；返回 up-to-date/fast-forward/merged/conflicts。原生 capability.merge 为 true，Web 为 false。冲突时 repository.merge 返回 session ID、sourceName/sourceOid，repository.conflicts 保留各侧路径、OID 和模式。

`conflictPreview(projectId,path)` 返回 projectId、path、三方描述、基础/当前/传入/工作结果四个 FilePreview（缺失为 null）、relatedPaths 和读取时的 GitStatus。预览可能显示链接、二进制或大文件原因，不能一律当作文本。换项目后 UI 不复用旧预览。

`resolveConflict(projectId,path,choice,expectedStatus)` 支持 ours/theirs/base/delete/working；必须传预览对应的完整状态。目录/文件相关路径成组处理。working 使用已经保存的工作树结果，不自动保存界面草稿；用户先通过原有 writeText/草稿流程保存，再标记解决。`continueMerge` 要求冲突清零并生成双父提交；`abortMerge` 恢复本次触及路径，保留无关更改，两者也传完整 GitStatus。中止会放弃相关路径的合并后编辑，界面需展示具体确认。普通 commitStaged 不能替代继续合并。

`rebaseBranch(projectId,{name,oid},expectedStatus)` 将当前分支重放到已核对的本地/远程目标，返回 up-to-date/fast-forward/completed/conflicts。原生 capability.rebase 为 true，Web 为 false。repository.rebase 包含原分支、目标、position/total、ready/conflicts 以及当前原提交摘要。进行中 HEAD 为 detached，不能据此误判项目没有原分支。

`conflictPreview/resolveConflict` 自动使用当前 merge/rebase 会话；变基时 ours 是目标及已重放结果，theirs 是当前原提交。`continueRebase` 在冲突已解决时重写该提交并继续，ready 状态从下一步骤继续；`skipRebase` 放弃当前冲突提交并恢复该步，`abortRebase` 放弃整个变基范围并恢复原分支，两者需具体确认。全部传完整 GitStatus 并检查持久草稿。原作者/时间/说明保留，提交者使用当前身份。重启收束既有 pending 意图与进度后，等待用户继续，不自动重放新步骤。

### 3.3 `conversations`

`getSnapshot/subscribe` 返回项目下对话、草稿和选中项；`ensureProject/create/select` 维护活跃选择；`rename/archive/restore` 管理对话生命周期；`saveDraft` 返回带 revision 的草稿。

草稿 revision 是提交回执身份的一部分，不是文件 revision。归档不删除 Run 或文件；运行中的对话不能归档。详见 [对话与轨迹](conversations-and-trace.md)。

### 3.4 `agent` 与 `runs`

`agent.start(projectId, prompt, imageAttached?, conversationId?, draftRevision?)` 完成资源准备、运行入队与草稿回执，然后返回；不等待完整任务结束。失败保留可重新提交的草稿。`cancel(runId?)` 请求取消，活跃执行可能先进入 cancelling，已进入关键区的文件操作仍需完成回执。

`agent.getSnapshot()` 返回活跃/最近完成展示、所有本进程已接纳根任务、starting、公开错误与 availability。它不是历史数据库；历史用 `runs.list`。`availability = recovery_required` 表示状态保存故障，不能继续派发。

| 查询                                                       | 返回                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `runs.list({projectId, conversationId?, cursor?, limit?})` | 根运行摘要页，不加载完整输入、结果和轨迹                           |
| `runs.getDetail(runId)`                                    | 完整 prompt/response 与公开运行字段，不含原始引擎帧                |
| `runs.listChildren(rootRunId, cursor?)`                    | 子运行摘要页                                                       |
| `runs.listTrace(runId, cursor?)`                           | 按 runSequence 的节点页                                            |
| `runs.readTraceText(nodeId, offset?)`                      | 文本正文片段、总长与 nextOffset                                    |
| `runs.subscribe(listener)`                                 | 带 runId/projectId/conversationId/rootRunId/state 的持久化变更事件 |

RunSummary、RunDetail、RunView 与 RunRecord 分离；UI 不依赖冻结配置、模型秘密值或内部 engine messages。分页游标不透明，不应由 UI 拼装。精确边界见轨迹文档。

### 3.5 `models`

`saveConnection` 接收非秘密连接输入和单独 key 操作；留空通常保留现有凭证，remove 明确删除。`copyConnection` 不复制秘密值。`saveModel` 独立管理条目和能力/参数；`setSelection` 设置 global/project/session 默认；session 在当前业务中对应 conversationId。`setProviderOrder(order, expectedRevision)` 原子保存供应商列表顺序，使用配置 revision 防止过期拖拽覆盖；order 必须是当前全部供应商节点的无重复排列。

`prepareIcon({name, bytes})` 是本地同步校验/编码，返回 `{mediaType, base64}`，不会立即保存。`saveConnection` 的可选 icon 与连接原子持久化，设为 undefined 恢复默认；直接保存仍执行校验，限制见 [模型配置](model-providers.md)。

`keyReady` 仅返回是否可用；`affectedDefaults` 支持删除影响提示；`diagnose` 执行 connection/text/tools/images 检测，connection 检测包含目录发现。它可以发网络请求，不能当作纯本地校验。`recoveryIssues` 用于凭证清理提示。

### 3.6 `mcp`

`configuration` 暴露配置快照、服务器保存/删除、keyReady 和按项目 grant；`discover` 联网发现目录；`unknown` 查询尚未解除屏障的结果未知记录；`acknowledge` 在用户核对后设置重试许可时间，不代表确认远端成功，也不自动重发调用。

### 3.7 `skills`

`getSnapshot/subscribe` 返回技能库及项目授权。`install/remove` 使用 expectedCommit 防止覆写库的新版本；`grant` 使用技能内容 revision。`bundle/versions` 按冻结版本读取；`decodeText/validateBundle/importPackage` 处理输入验证，不赋予执行脚本权限。

### 3.8 `agentSettings / preferences / io / proposals`

- `agentSettings.save` 使用设置 revision 保存系统提示词与 limits；当前任务使用启动快照，配置变化影响后续任务。
- `preferences.getWorkbench/saveWorkbench` 保存项目选择和主题偏好；提交说明草稿等其余 UI 瞬时状态不自动持久化。
- `io.pickFile/pickSkillPackage` 返回用户选定内容或 undefined；`exportFile/exportSkill` 处理平台分享/下载。取消选择不是失败。
- `proposals?.preview(rootRunId,id)` 只供 UI 查看公开差异。合入由根 Agent 的受控 `apply_proposal` 工具进行，当前没有 UI 通用提案写入 API。

`GitStatus.head` 在空仓库中为 null，branch 为实际当前分支名称，分离 HEAD 时为 null。index 与 working 指纹包含模式；历史 Version 使用 parents 数组和 author/committer，不限第一父。`ReviewFile` 使用 `status: added | modified | deleted`、可选 stagedOnly、内容 `kind: text | image | binary` 及 beforeSize/afterSize（该侧不存在为 null）。before/after 是预览字符串；无法预览或两侧类型不同则为空，并附 unavailableReason。Git 工具及提案检查的差异结果同步使用这些字段。

`workspace.taskChangeSummary(runId)` 返回该任务冻结前后快照的文件摘要：`path/status/stagedOnly/kind` 与可选 `added/removed`。它不使用当前工作区推算历史，也不返回全文。图片、二进制、无法预览或超出统计预算的文本不提供行数，UI 保留差异入口。该查询经 facade 解析 runId，统计库在 adapter 中使用，界面不直接读取 Git。

图片上传复用 `io.pickFile('image')`，仅向系统/浏览器选择器提供 PNG/JPEG/WebP 类型；取消返回 undefined，结果仍是 `{name, bytes}`。普通文件导入调用无参数 pickFile，选择器不限制扩展名或 MIME；调用 workspace.write 保存字节并执行路径、版本和资源预算检查。供应商图标与技能包仍执行各自领域校验。界面不直接访问平台文件或凭证存储。

## 4. 乐观并发与命令示例

```ts
const file = await services.workspace.read(projectId, 'documents/notes.md');
await services.workspace.writeText(
  projectId,
  'documents/notes.md',
  new TextEncoder().encode('更新后的文字'),
  file.revision,
);

const state = await services.workspace.status(projectId);
const path = 'documents/notes.md';
await services.workspace.stage(projectId, [path], {
  head: state.head,
  indexRevision: state.indexRevision,
  revisions: { [path]: (await services.workspace.read(projectId, path)).revision },
});
const staged = await services.workspace.status(projectId);
await services.workspace.commitStaged(projectId, '整理资料', {
  head: staged.head,
  indexRevision: staged.indexRevision,
});
```

各步骤之间可能发生其他变化；服务会验证基线并以 CONFLICT 拒绝过期命令。UI 应刷新、展示差异并让用户重新操作，不能把 expectedRevision 自动替换为最新值后悄悄重试写入。

项目处于根任务占用或恢复阻断时，界面写入会被服务拒绝。按钮禁用只是 UX，最终控制仍在用例层。

## 5. 错误契约

| code        | 含义                                  | 调用者处理                               |
| ----------- | ------------------------------------- | ---------------------------------------- |
| VALIDATION  | 输入、路径、配置或授权不合法          | 更正输入/授权                            |
| CONFLICT    | 文件、index、配置 revision 或范围变化 | 刷新并重新确认操作                       |
| CANCELLED   | 宿主停止请求或运行收束                | 显示已停止；不抹掉已保存结果             |
| LIMIT       | 大小、预算、时长等限制                | 缩小范围或按允许边界调整设置             |
| STORAGE     | 持久化或恢复失败                      | 保留数据、停止受影响写入、按恢复流程处理 |
| REMOTE      | 服务、网络或协议失败                  | 检查配置和状态；有副作用时先检查回执     |
| UNKNOWN     | 未分类失败或不确定结果                | 读取 `uncertain`；不将未知解释为“未执行” |
| DATA_FORMAT | 当前开发实例格式不匹配                | 只走明确的开发重建流程                   |

`publicError` 不透传未知原生异常、cause 或路径。`uncertain` 表示效果可能已发生，不等于普通可重试错误。停止原因另外用结构化 StopReason 表达，不从中文错误消息反推控制逻辑。

## 6. 接口变更检查

修改 services 契约 → facade 实际投影 → 调用页面/hooks → 对应应用用例及测试 → 文档历史。不要使用重导出、兼容别名或额外 legacy 字段维持旧原型。

验证入口：[app-services.test](../tests/app-services.test.ts)、[architecture-boundaries.test](../tests/architecture-boundaries.test.ts)、[公共错误](../src/core/errors.ts)。
