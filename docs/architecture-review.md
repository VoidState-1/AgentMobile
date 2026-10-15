# Agent Mobile 架构质量审查

日期：2026-10-14。审查基线：`9893b85`。状态：问题记录与改进建议，本文所列整改尚未实施。

审查范围包括分层边界、根任务与子任务执行、工作区与 Git、运行持久化、模型配置、MCP、Skills，以及工作台数据读取。产品范围和实际实施状态仍以 [design.md](F:/ReactProject/AgentMobile/docs/design.md) 为准。

## 1. 总体结论

系统的架构方向比较扎实，但实现尚未完全收敛。当前最值得处理的问题是：公共执行机制重复、旧格式兼容侵入当前模型，以及查询和持久化仍按小规模原型设计。

建议保留现有分层、受控工作区、项目写入队列和中断恢复机制，进行定向重构。当前没有充分理由推倒重写，也不需要立即引入更复杂的插件框架。

在尚未发布、没有公开数据格式兼容承诺的前提下，可以统一当前数据格式。需要保留的开发数据可以通过一次性迁移处理，主运行链不必持续兼容每一代原型格式。

## 2. 应当保留的设计

- core/application/adapters 的职责划分已经有实际代码支撑，领域与应用逻辑基本保持平台无关。
- UI 通过运行时实际裁剪的 AppServices 使用业务能力，没有仅靠 TypeScript 类型隐藏底层实例。
- 项目写入由统一队列协调，修改检查基础版本，文件、index 和 HEAD 的语义有所区分。
- Git、文件、SQLite 和凭证之间的中断处理采用日志、检查点及回执，没有假定存在跨存储事务。
- MCP 对远程调用结果未知、重复派发和取消后不确定性进行了专门处理。
- 子任务通过固定输入快照和隔离提案限制文件能力，这些权限边界应在重构中继续保留。

## 3. 问题总表

优先级表示整改顺序和架构影响，不等同于生产事故等级。扩展性风险尚未经过真机压力测试。

| 编号 | 问题                                                 | 优先级 | 证据性质                                        |
| ---- | ---------------------------------------------------- | ------ | ----------------------------------------------- |
| A1   | 根任务和子任务重复维护执行生命周期，终止判定存在差异 | 高     | 代码确认；子控制器截止时间行为有独立探针验证    |
| A2   | 全量查询、文件重复读取和完整快照重写叠加             | 高     | 调用链确认；实际性能影响待测量                  |
| A3   | 旧数据兼容进入当前运行类型和日常初始化               | 中     | 代码确认；结合未发布阶段判断为可清理债务        |
| A4   | 技能库通过隐藏模式继续使用旧自动提交日志流程         | 中     | 代码确认；旧路径仍有当前调用者                  |
| A5   | live/snapshot/proposal 三套文件工具重复实现公共行为  | 中     | 代码确认；存在能力和返回格式差异                |
| A6   | 根据中文错误文案推断错误类型与可展示性               | 高     | 已验证普通对话校验错误被转为 STORAGE            |
| A7   | 角色配置部分不参与执行，工具副作用默认推断为 read    | 中     | 字段引用和执行路径确认；未发现已有工具因此越权  |
| A8   | 分层检查规则不完整，公共契约依附具体实现类           | 中     | ESLint 缺口有探针验证；当前未发现 core 逆向依赖 |

## 4. 问题详情

### A1. 根任务和子任务重复维护执行生命周期

根控制器和子控制器分别处理请求准入、工具预算、取消、超时、终态、轨迹持久化及收尾。这些公共规则需要在两条路径中分别修改和验证。

已经确认一个行为差异：根控制器优先检查预算错误；子控制器在记录截止时间错误后，优先判断引擎是否返回 `aborted`。独立调用子控制器并触发其截止时间时，最终结果为 `cancelled`，且 `task.error` 没有保留超时原因。该验证说明子控制器自身存在判定缺口，不代表完整任务组中每次超时都会以同样的时序发生。

影响：公共终止规则容易漂移，调用者难以稳定区分用户取消、预算耗尽、截止时间和引擎错误。

建议：提取公共执行生命周期和终态判定，显式记录终止原因，例如 `user_cancel`、`deadline`、`budget_exhausted`、`engine_error`。根任务保留委派收束，子任务保留快照和提案处理；权限及存储差异继续通过受限能力注入。

代码依据：[根控制器](F:/ReactProject/AgentMobile/src/application/runs/controller.ts:75)、[子控制器](F:/ReactProject/AgentMobile/src/application/runs/child-controller.ts:56)。

### A2. 查询和持久化仍按小规模原型设计

当前存在几条相互叠加的全量处理路径：

- 工作台刷新调用 `tasks(projectId)`，运行仓库的 `views()` 遍历全部分页，并逐个加载轨迹及子任务。
- `nextSequence()` 每次读取整个 operations bucket，再筛选项目和计算最大序号；工作区快照也读取整个 bucket 后筛选。
- 文件列表为了获取 revision，会读取并哈希全部文件内容；`workingTree()` 随后再次读取文件。
- 流式记录按约 200ms 合并后重写完整任务及完整轨迹；每轮 assistant 结束还保存完整 transcript。
- SQLite 的主要业务存储仍为 `records(bucket, id, payload)`，大量筛选在读取 JSON 后完成。

影响：项目文件数、历史任务数和轨迹长度增长时，刷新、序列化、内存占用及写入成本会同时上升。已有分页接口被上层重新汇总成全量读取，尚未形成实际的有界加载。

建议：先为任务列表提供摘要分页，展开时再加载轨迹和子任务；操作日志支持按项目和状态查询，序号单独维护；轨迹改为节点或增量保存；文件索引复用已知修订。按实际查询需求逐步增加存储索引，无需一次性重建全部数据库。

代码依据：[工作台刷新](F:/ReactProject/AgentMobile/src/features/workbench/use-workbench-data.ts:39)、[运行视图](F:/ReactProject/AgentMobile/src/application/runs/repository.ts:89)、[工作区快照](F:/ReactProject/AgentMobile/src/application/workspace/service.ts:54)、[操作序号](F:/ReactProject/AgentMobile/src/application/workspace/mutations.ts:111)、[文件遍历](F:/ReactProject/AgentMobile/src/application/workspace/reader.ts:25)、[轨迹保存](F:/ReactProject/AgentMobile/src/application/runs/recorder.ts:24)、[SQLite 存储](F:/ReactProject/AgentMobile/src/adapters/storage/platform.ts:19)。

### A3. 旧数据兼容侵入当前领域模型

模型配置、旧 tasks/transcripts、对话图和轨迹展示中都保留了历史兼容路径。兼容不只存在于迁移入口，还影响当前类型与执行：

- `TaskRecord` 同时承担当前执行视图和旧记录兼容格式。
- `RunRecord` 继承这个兼容 DTO，使持久化模型受到展示与历史格式约束。
- 新任务同时维护 `events` 和 `trace` 两种工具过程表达。
- 初始化继续读取旧任务来源并执行迁移或核对。

影响：增加可空字段、回退分支和重复表达，使新实现必须持续考虑已经停止使用的格式。这里主要属于对旧数据的向后兼容。

建议：统一当前 Run、LaunchSnapshot 和 Trace 格式；将需要的数据迁移集中为一次性流程，再删除正常执行中的兼容分支。持久化记录和 UI 查询 DTO 分别定义，避免由当前领域记录继承旧展示格式。格式版本标识、幂等回执和中断恢复仍需保留。

代码依据：[模型迁移](F:/ReactProject/AgentMobile/src/application/models/configuration.ts:48)、[任务迁移](F:/ReactProject/AgentMobile/src/application/runs/repository.ts:114)、[对话迁移](F:/ReactProject/AgentMobile/src/application/conversations/service.ts:39)、[TaskRecord](F:/ReactProject/AgentMobile/src/core/runs/types.ts:10)、[RunRecord](F:/ReactProject/AgentMobile/src/core/runs/records.ts:9)。

### A4. 技能库通过隐藏模式使用旧自动提交流程

普通工作区采用保存、暂存和提交分离的语义；技能库通过构造器中的 `automaticCommits=true` 使用自动提交流程。日志用缺失的 `kind` 表示原自动提交语义，`apply()` 与 `applySeparated()` 分别维护文件应用、阶段持久化和恢复。

这条路径仍有当前调用者，不能直接当作无用兼容代码删除。问题在于一个位置靠后的布尔参数改变了持久化语义，并使通用工作区继续承担两套日志流程。

影响：修改文件恢复逻辑时需要同时维护两套实现；缺失字段既表达历史格式，又表达当前技能库的运行模式，增加理解和测试成本。

建议：统一文件操作日志和恢复底座，由技能库显式编排提交。若过渡阶段仍需两种操作，至少使用明确的操作类型，避免由缺失字段或布尔位置参数决定行为。

代码依据：[技能库构造](F:/ReactProject/AgentMobile/src/adapters/skills/repository.ts:11)、[工作区构造参数](F:/ReactProject/AgentMobile/src/adapters/workspace/service.ts:10)、[日志分流](F:/ReactProject/AgentMobile/src/application/workspace/mutations.ts:55)。

### A5. 三套文件工具重复实现公共行为

live workspace、固定 snapshot 和 proposal overlay 各自实现文件列表、分段读取和图片读取，部分还重复实现搜索、移动或删除。三者权限和存储语义不同，但读取分页算法、搜索片段、参数 schema 和输出格式具有较多共性。

现有实现已经出现差异，例如 writer 提案没有搜索工具，各套读取结果及校验细节也不完全一致。能力差异不一定都是错误，但应由明确的能力策略决定，而非分别实现后自然分化。

影响：增加或修复同一文件能力时需要修改多个位置，公共行为容易漂移。

建议：围绕受限的文件读取能力共享工具实现，复用分页、搜索和输出格式；写入使用独立能力接口。保留每个后端的授权校验，尤其不能为了复用而把完整 live workspace 暴露给只读子任务。

代码依据：[工作区工具](F:/ReactProject/AgentMobile/src/application/tools/workspace.ts:8)、[快照工具](F:/ReactProject/AgentMobile/src/application/tools/snapshot.ts:12)、[提案工具](F:/ReactProject/AgentMobile/src/application/runs/proposal-overlay.ts:67)。

### A6. 错误处理依赖中文文案前缀

`publicError()` 通过长正则表达式判断错误消息能否展示，并据此转换错误类型。多数命中文案被统一归为 `VALIDATION`，未命中则归为 `STORAGE`。

已验证：`对话不存在或已归档，请重新选择。` 会被转换为 `STORAGE`，显示“本地操作失败，请重试或重新打开应用恢复”。原本应当重新选择对话的问题，被报告为本地存储故障。

影响：修改提示文字可能改变错误分类；UI 和模型得到错误的恢复指引，也难以依赖稳定错误码处理冲突、取消和预算耗尽。

建议：在错误产生处使用明确的 `AppError(code, message)`，边界负责未知异常脱敏。文案与错误类型分离，不再通过中文前缀推断业务语义。

代码依据：[错误转换](F:/ReactProject/AgentMobile/src/core/errors.ts:10)、[对话校验](F:/ReactProject/AgentMobile/src/application/conversations/service.ts:34)。

### A7. 角色声明部分不参与执行，工具副作用存在隐式默认值

`AgentDefinition` 看起来提供通用的角色与权限声明，但当前执行仍绑定固定角色：

- `mayDelegate` 没有被执行路径读取，修改该字段不会改变委派能力。
- spawn schema 固定声明 reader/reviewer/writer，角色选择直接查询内置定义。
- 子任务检查 `allowedEffects`，根任务工具集没有根据主 Agent 的该字段收紧。
- `defineTool()` 允许省略 `effect`，根据工具名称推断，最终默认成 `read`。

影响：配置表达的约束超过了实际执行约束。新增副作用工具时，若忘记显式分类，类型系统无法阻止它被误归为只读。本次未发现已有工具因此发生越权。

建议：强制工具声明副作用；让角色权限字段参与工具构建和执行检查。固定角色可以继续满足当前范围，自定义角色确有需求时再引入注册表；未实现的角色编辑、子模型选择等能力继续明确标注。

代码依据：[角色定义](F:/ReactProject/AgentMobile/src/core/agents/types.ts:3)、[固定角色 schema](F:/ReactProject/AgentMobile/src/application/runs/delegation.ts:53)、[根工具构建](F:/ReactProject/AgentMobile/src/application/runs/controller.ts:61)、[子权限检查](F:/ReactProject/AgentMobile/src/application/runs/child-controller.ts:33)、[副作用推断](F:/ReactProject/AgentMobile/src/application/tools/common.ts:11)。

### A8. 分层检查不完整，公共接口依附具体实现

core 和 application 共用导入限制，但没有禁止 core 导入 application。ESLint 探针确认，这种逆向导入目前能够通过。当前代码中未发现实际的 core → application 依赖，因此这是防回归规则的缺口。

此外，AppServices 多处用 `Pick<具体 Service 类>` 定义接口，使公共契约继续随实现类的方法签名变化。运行时 facade 确实裁剪了底层实例，这一点应当保留；契约独立性仍可加强。

影响：未来新增代码可能在检查通过的情况下破坏依赖方向；应用入口也较难作为独立、稳定的能力边界演进。

建议：分别定义 core 和 application 的依赖规则，补充允许和禁止导入的边界测试；对稳定的命令、查询和 DTO 显式定义公共接口，由实现类满足接口。

代码依据：[ESLint 配置](F:/ReactProject/AgentMobile/eslint.config.js:8)、[公共服务类型](F:/ReactProject/AgentMobile/src/application/services.ts:48)、[运行时 facade](F:/ReactProject/AgentMobile/src/bootstrap/facade.ts:20)。

## 5. 硬编码与特化设计的判断

| 现象                                      | 判断                             | 处理方向                           |
| ----------------------------------------- | -------------------------------- | ---------------------------------- |
| 三种模型协议独立编解码                    | 有协议差异支撑，属于合理拆分     | 继续共享 HTTP/SSE 基础能力         |
| Web 与原生各有存储实现                    | 有平台差异支撑，属于合理适配     | 保持统一契约及行为验证             |
| 当前 Agent 只写 `.md/.txt`                | 符合图文资料助手的产品范围       | 扩展范围时再引入文件能力策略       |
| 默认预算、提示词和供应商预设为常量        | 合理默认值                       | 避免在多个模块重复维护同一规则     |
| 固定 reader/reviewer/writer               | 当前范围可接受，通用扩展尚未实现 | 让权限声明实际生效，避免假通用接口 |
| `automaticCommits` 和缺失 `kind` 改变流程 | 隐式模式，增加持久化复杂度       | 显式操作类型和统一日志底座         |
| 按工具名称推断副作用                      | 脆弱的隐式契约                   | 要求显式声明                       |
| 按中文文案前缀推断错误                    | 已造成错误分类                   | 使用稳定错误码                     |

中断恢复、基础版本校验、幂等回执和 MCP 未知结果屏障解决的是当前可靠性问题，不能作为兼容包袱一并删除。

## 6. 建议整改顺序与验收重点

| 阶段                  | 改动范围                                                           | 验收重点                                                                           |
| --------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1. 修正已验证行为     | 统一终止原因；修正错误分类                                         | 用户取消、截止时间、预算耗尽和引擎故障保留正确状态与原因；对话校验不再误报存储故障 |
| 2. 收敛当前数据模型   | 清理旧格式兼容；分离存储记录与查询 DTO；减少 events/trace 重复表达 | 新执行只依赖当前格式；需要的数据完成一次性迁移；当前格式的中断恢复仍通过           |
| 3. 合并公共机制       | 提取公共执行生命周期、文件读取工具和日志底座                       | 根/子行为一致；快照隔离、提案冲突、取消、租约释放和不重放副作用保持正确            |
| 4. 实现有界读取和写入 | 摘要分页、轨迹按需加载、项目日志查询、独立序号、增量保存           | 大量历史与长轨迹下不再每次全量加载；结合真机测量确定后续优化                       |
| 5. 补齐约束           | 强制 effect、执行角色权限、完善 ESLint、独立公共契约               | 新工具不能遗漏副作用分类；core 逆向导入失败；已有权限边界不被放宽                  |

每次实施仍需运行 `npm run check`。涉及持久化和恢复的改动，应补充针对失败位置、取消时序、重复调用及重启恢复的验证。

## 7. 验证记录与结论边界

- 审查时 `npm run check` 通过：TypeScript、ESLint 和 165 项单元测试成功。
- 额外三个临时探针通过，确认了子控制器截止时间分类、对话错误误归类，以及 core 导入 application 的 ESLint 缺口。
- 临时探针用于验证当前行为，审查后已删除；本次文档交付不包含问题修复。
- 性能判断基于调用链、数据读取范围和写入方式，没有进行真机压力测试，不将扩展性风险表述为已发生的性能事故。
- 本轮没有重新执行 Android、iOS 或浏览器端到端回归；已有验证结果的适用范围见 [validation.md](F:/ReactProject/AgentMobile/docs/validation.md)。
