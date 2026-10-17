# 存储结构与中断恢复

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                                     |
| -------- | ------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| 2.1.0    | 2026-10-17T00:09:49+08:00 | fd29c75e38d245b3a8e5cfb6a93c0b2156029d22 | 同步尚未提交源码：记录精确替换请求指纹、回执重建与候选检查点恢复。           |
| 2.0.0    | 2026-10-16T23:27:39+08:00 | 798aea13020fdad314b8a34bc78d7eadb2ac0bf0 | 同步尚未提交源码：记录 f5、物理版本 6、Run schema 4 与移除执行模式索引字段。 |
| 1.0.0    | 2026-10-15T17:24:30+08:00 | 9ad009be8a41df28a02060c5620ee12a29c3d901 | 记录当前数据格式、数据库布局、事务边界、启动恢复与开发重建。                 |

## 1. 存储分工

| 数据                                     | Android/iOS                                 | Web                                | 事实来源                                 |
| ---------------------------------------- | ------------------------------------------- | ---------------------------------- | ---------------------------------------- |
| 项目/技能文件与 `.git`                   | Expo FileSystem 私有文档目录 `agent-mobile` | IndexedDB `files` store            | Git 文件内容及快照；工作树是当前编辑状态 |
| 配置、项目/对话元数据、运行、轨迹、回执  | `agent-mobile.sqlite`                       | `agent-mobile-prototype` IndexedDB | BusinessStore                            |
| 模型/MCP 秘密值                          | SecureStore                                 | 页面生命周期内 Map                 | CredentialStore，不序列化到业务记录      |
| 主题和项目选择偏好                       | 数据库 preferences record                   | records store                      | PreferencesService                       |
| 当前页签、对话选择投影、弹层、编辑中内容 | React/Zustand 内存                          | React/Zustand 内存                 | 界面临时状态                             |

[HostFileSystem / MetadataStore / CredentialStore](../src/core/storage/contracts.ts) 是平台无关端口。BusinessStore 扩展元数据端口，提供有类型的操作、运行和轨迹事务，不暴露 SQL 或 IDBTransaction。

Git adapter 使用内部逻辑目录 `/workspaces/<id>/repository`。这是 HostFileSystem 命名空间，不是设备绝对路径；原生由平台 adapter 映射到私有根目录。技能库通过 `skills` 日志 namespace 与 `skill-projects` bucket 隔离，与用户项目共用底层存储但不混用业务查询范围。

## 2. 当前格式与实例身份

[CURRENT_DATA_FORMAT](../src/core/storage/business-store.ts) 当前为 `agent-mobile-f5`。SQLite `PRAGMA user_version` 和 IndexedDB physical version 当前为 `6`。三种版本的职责不同：

- format 标识校验整个当前开发实例的可读结构。
- physical version 表示平台数据库结构，不维护历史迁移链。
- 记录中的 schemaVersion 表示当前 DTO 契约，如 OperationHeader 为 2，RunRecord/Header 为 4，TranscriptFrame 为 1。

数据库同时生成 `instanceId`。Run 和轨迹游标绑定该身份，数据重建后旧游标会被拒绝，而不是误读新实例中的同名记录。格式检查失败阻断正常 bootstrap，不用历史字段读取或自动升级兜底。

## 3. SQLite 表布局

精确 DDL 见 [sqlite-business.ts](../src/adapters/storage/sqlite-business.ts)。启用 WAL 与 foreign_keys，写入通过 `withExclusiveTransactionAsync` 串行执行。

| 表                   | 主键/重要索引                                                              | 保存内容                                      |
| -------------------- | -------------------------------------------------------------------------- | --------------------------------------------- |
| `application_format` | 固定 id=1                                                                  | format 与 instance_id                         |
| `records`            | `(bucket,id)`                                                              | 小规模配置、冻结快照、业务状态等 JSON payload |
| `operation_headers`  | `(namespace,project_id,id)`；scope sequence 唯一；owner、pending 索引      | 阶段、revision、归属、路径、指纹和引用摘要    |
| `operation_bodies`   | 与 header 相同；引用 header                                                | before/after 与 indexChanges 正文             |
| `operation_counters` | `(namespace,project_id)`                                                   | 范围内递增 operation sequence                 |
| `run_headers`        | id；admission_sequence 唯一；project/conversation/history/root/active 索引 | 运行摘要、状态、计数、快照引用、停止原因      |
| `run_inputs`         | id → run_headers                                                           | 不可变 prompt                                 |
| `run_results`        | id → run_headers                                                           | response 与 skillActivations                  |
| `run_counters`       | 固定 id=1                                                                  | 全实例运行入队序号                            |
| `trace_nodes`        | id；`(run_id,run_sequence)` 唯一                                           | 轨迹类型、顺序、状态、摘要与正文长度          |
| `trace_text_chunks`  | `(node_id,ordinal)`；offset 索引                                           | 连续追加正文块与 UTF-16 偏移                  |
| `transcript_frames`  | `(run_id,ordinal)`                                                         | 引擎消息完成帧，独立 opaque payload           |

索引列用于小范围查询，JSON payload 保存当前领域形状。列表读取 headers，不把完整 prompt、结果、Base64 操作正文和轨迹树放在同一个大 JSON record 中反复读写。

## 4. IndexedDB 对应布局

[indexeddb-business.ts](../src/adapters/storage/indexeddb-business.ts) 提供同名 operation/run/trace stores 和 `records`，格式 store 名为 `format`，另外有 `files`。域内索引使用组合 key；record key 是 `bucket/id`，`all(bucket)` 用前缀 key range，不全库扫描无关 buckets。

`files` 的 `stat` 索引包含 `[path,kind,size,mtime,contentVersion]`。stat 走 key cursor，不克隆文件 bytes；真正读取时才获取 StoredFile。Web 写入为每个文件生成新的 contentVersion，用于轻量缓存失效。

旧 IDB physical version 升级请求被中止，返回格式不匹配；不会在 onupgradeneeded 内迁移旧 stores。versionchange 会关闭连接，要求刷新；其他页面占用时返回 blocked 错误，需要先关闭旧连接。

虽然 Web 文件和业务数据放在同一个数据库，当前 HostFileSystem 与 BusinessStore 调用仍分别提交事务，**没有把 Git、files 和业务回执合并为一个跨层事务**。

## 5. `records` 的业务 bucket

| bucket                                            | 内容/键的范围                                       |
| ------------------------------------------------- | --------------------------------------------------- |
| `projects` / `skill-projects`                     | 用户项目 / 技能库内部项目，按项目 id                |
| `conversations`                                   | `state`：对话目录、选中项与草稿                     |
| `model-config` / `model-key-ops`                  | 模型图配置 / 凭证新建与退役意图                     |
| `mcp-config` / `mcp-key-intents` / `mcp-attempts` | 服务器与授权 / 凭证意图 / 远程调用回执              |
| `skills`                                          | `configuration`：库版本、摘要与项目 grants          |
| `settings`                                        | `agent`：系统提示词与 limits                        |
| `preferences`                                     | `workbench`：工作台偏好                             |
| `run-launches`                                    | 按 launchSnapshotRef 的冻结配置                     |
| `accepted-drafts`                                 | `conversationId/revision`：已接纳目标的运行回执     |
| `run-groups` / `run-delegations`                  | 共享预算 / 委派幂等回执                             |
| `change-proposals` / `proposal-writes`            | 按提案 ID 保存候选状态 / 按调用 ID 保存候选写入意图 |

这是逻辑布局说明，新增业务不要直接将领域事实写到未归属的随意 bucket。持久化调用集中在相应 service/repository。

## 6. 同数据库原子边界

`prepareOperation` 原子保存 operation body/header，并分配 scope sequence。精确替换仍使用 files 操作，OperationBody 的 textEditFingerprint 保存路径、基础 revision 与整批替换参数的请求指纹，并纳入 bodyFingerprint 校验；该字段不进入 header 或 UI 操作摘要。重试核对指纹及 owner/path，以日志 before 重建并验证 after，recorded 回执直接返回原结果，不重新改写当前文件。这里增加的是编辑操作正文元数据，不新增 SQL/IDB stores 或历史格式读取分支。相同 ID 与相同不可变意图可复用；意图不匹配返回 CONFLICT。

`writeBusiness` 可以一次原子写入元数据、OperationHeader 更新、RunHeader/Input/Result 更新、TraceNode/Chunk/Frame。典型场景包括：

1. 根 Run 初次入队 + 冻结 launch + accepted-draft 回执。
2. 子 Run 创建 + 父 childCount + 委派回执 + 子预算 allocation + 父工具轨迹关联。
3. 轨迹增量与对应运行状态/结果的同批保存。
4. operation 最终 recorded 回执 + 项目 updatedAt。

更新使用 expectedRevision；不可变归属、sequence 和输入不能改，终态 Run 不能重新活跃。轨迹必须连续追加，不能由新块覆写已结束节点。具体约束见 core 的 assert 函数。

Git objects/refs、真实文件与 SecureStore 不参与此事务；模型和 MCP 的远端效果更不参与。故障处理要辨别“效果未发生”和“效果发生但回执未落库”。

项目初次创建当前按 init Git → 写初始文件 → 初始 commit → 保存项目元数据顺序执行，没有专用创建意图跨存储对账。中断可能留下未登记的内部仓库；自动扫描重新登记或回收这种孤立初始化资料尚未实现。操作日志的恢复保证主要覆盖已登记项目的受控修改，不能概括为全部启动/创建步骤均具备原子性。

## 7. 启动恢复顺序

```mermaid
flowchart TD
    S[打开并校验当前格式] --> C[模型凭证意图 / 配置初始化]
    C --> W[项目文件与 Git 操作日志恢复]
    W --> M[MCP prepared / dispatched 回执收束]
    M --> K[技能库操作恢复与版本授权对账]
    K --> P[候选写入与合入回执恢复]
    P --> R[活跃子任务先于父任务收束为 interrupted]
    R --> D[草稿与 accepted-draft 精确对账]
    D --> A[创建运行内核并开放 UI 服务]
```

顺序由 [bootstrap](../src/bootstrap/index.ts) 固定。恢复只读取意图、对象和回执，不创建 Pi 引擎，不重新请求模型，不重放远程工具。

- **文件操作**：依 scope sequence 读取 pending headers，一次加载一条正文；实际文件/index 必须等于 before 或 after，HEAD 必须与意图基线一致，或已找到带 operation marker 的公开提交。校验不通过阻断该项目写入。
- **MCP**：prepared 转 cancelled；dispatched 转 unknown，保留重试屏障。
- **Skills**：恢复 skills namespace 工作区日志，再按 Git 最新库快照重建摘要并移除过期授权。
- **提案候选**：prepared 写入若有 checkpoint ref则验证路径并完成回执，没有 ref则取消该写入；合入用 operation 回执决定 applied/ready/interrupted。
- **Run**：按 depth 降序恢复子任务，然后父任务；活跃/排队运行转 interrupted。尽可能收集已持久化最终轮文本和本任务归属快照。
- **草稿**：只清理与已接纳 Run 完全匹配的 projectId/conversationId/revision，不清理后续新输入。

## 8. 失败后的行为

| 失败位置                                              | 当前行为                                         | 维护原则                                      |
| ----------------------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| operation 正文缺失/指纹不符、Git 对象损坏、基线不一致 | 受影响项目写入阻断并显示 recoveryIssues          | 保留现场；不猜测覆盖用户内容                  |
| 运行 checkpoint/终态保存失败                          | 内核 recovery_required，停止派发并请求重开       | 不把未持久化完成状态显示成成功                |
| 普通命令失败                                          | SerialQueue 拒绝该命令，后续独立命令仍可进入队列 | 不能把这一语义用于必须阻断后续工作的 recorder |
| Recorder 持久化失败                                   | 写链保留 rejection，最终保存无法跨过失败         | 保证轨迹/回执缺失可见                         |
| 凭证清理失败                                          | 保留意图，启动或租约释放后重试                   | 不提前删除当前配置或活跃运行引用的 Key        |
| 远端结果不明/回执保存失败                             | unknown 或 dispatched 屏障                       | 不自动重复同一远程效果                        |

## 9. 开发格式重建

仅在 bootstrap 因 DATA_FORMAT 失败、服务尚未创建时，`rebuildDevelopmentData()` 可触发重建。运行中的服务、普通 STORAGE 错误或任意用户数据异常不满足入口条件。

原生流程：校验私有根目录 → 在根目录外写 `agent-mobile-rebuild.pending` → 删除本应用 SQLite 数据库 → 删除本应用 `agent-mobile` 文件根 → 清除标记。中断后标记阻断下次正常启动，重新明确重建可完成残余步骤。SecureStore 不在删除范围；因业务引用已丢失，保留的凭证不一定会被新配置自动使用。

Web 只删除当前 origin 的 `agent-mobile-prototype` 数据库。其他标签页占用时要求关闭；不删除全部浏览器存储或其他 origin。内存 Key 随页面结束消失。

这不是面向已发布用户的数据迁移。没有旧格式读取、升级/降级或自动导入链；需要保留开发资料时先通过支持的导出或在受控测试现场留档。

## 10. 数据维护限制

当前没有自动 GC、历史清理、云同步或完整项目备份/恢复产品能力。日志 before/after、Git checkpoint 和 transcript 会积累；分页减少读取量，不降低已经持久化的数据总量。trace 的内部恢复路径仍可能读取整条运行轨迹，大任务不能仅凭分页 UI 宣称内存有固定上限。

文件内容缓存只用于减少读取；原生 contentStamp 使用 MD5，Git blob SHA 才是 revision。缓存不作为授权或写前版本证据，实际修改前仍读取内容校验。

## 11. 验证入口

[当前格式/事务测试脚本](../scripts/storage-current-format.mjs)、[范围查询脚本](../scripts/storage-range.mjs)、[journal.test](../tests/journal.test.ts)、[run-repository.test](../tests/run-repository.test.ts)、[trace-storage.test](../tests/trace-storage.test.ts)、[模型配置测试](../tests/model-config.test.ts)、[提案测试](../tests/proposals.test.ts)。原生故障注入脚本的范围与执行方法见 [测试与维护](testing-and-operations.md)。
