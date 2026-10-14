# Agent Mobile 产品与技术设计

日期：2026-10-14
状态：可交互原型。第 2 节记录实际实现，其余章节中尚未实现的首版目标仍为设计方案。

新的重构与多 Agent 架构见 [architecture-v2.md](architecture-v2.md)：R0–R2 已完成，实际执行使用 RunKernel、v2 运行仓库、持久化组预算与请求池；暂时限制一个活动根任务，每次运行创建独立 Pi Agent。R3–R5 的子 Agent、不同项目并发和隔离提案尚未完成。

## 1. 产品目标与范围

Agent Mobile 是手机端的本地 Agent harness。用户把文字和图片导入项目，通过对话让 Agent 整理、创建和修改内容，在任务完成后查看成果与修改清单，并可恢复历史版本。

“本地”首先指工作区、工具执行、任务状态、会话和文件历史保存在手机。首版调用云端模型；调用时按需发送选定文本和图片，不宣称完全离线或数据永不出设备。

核心验证场景：导入数张截图和文字备注 → 整理成 Markdown 图文资料 → 根据反馈改写、重排和替换图片 → 查看差异 → 撤销整次修改 → 导出。

首版包含：

- Android 优先验证，保持 Android/iOS 双平台架构。
- 多个独立项目；UTF-8 文本、Markdown，以及 JPEG/PNG/WebP 图片。
- 文件和目录的创建、读取、修改、移动、重命名、删除。
- 文本搜索和局部编辑；图片理解、裁剪、旋转、缩放；保留原始图片。
- 单工作区单写任务，持久化执行记录，暂停、取消和崩溃恢复。
- 本地 Git 仓库；版本保存、文件差异、任务差异和历史恢复。
- 用户自带 API Key；先接通一家支持图片输入和工具调用的供应商。
- 导入、预览、导出和系统分享。

首版不包含：编程、shell、任意代码执行、远程 Git、分支合并、多设备同步、多人协作、常驻后台 Agent、端侧大模型。

图片生成和语义修图作为后续可选模型能力，需独立处理费用、远程任务状态和结果导入；不属于首版必需能力。

长期方向：结构化 IntelligentUI → 静态网页成果 → 受控 JavaScript 网页沙箱。

## 2. 当前原型的交付边界

| 内容 | 状态 |
| --- | --- |
| Git 开发仓库、npm 锁文件、忽略规则 | 已初始化 |
| Expo SDK 57、React Native、TypeScript、Expo Router | 已配置 |
| Development Build、SQLite、文件、图片、SecureStore 依赖 | 已安装并配置 |
| 项目创建、文件列表、文本编辑、导入导出、移动删除 | 已实现 |
| 前端工作台 | 紧凑布局、深浅/系统主题、手机固定输入区、桌面文件侧栏；浏览器和 Android 模拟器操作已验证 |
| 资料实时更新 | 每次文件操作完成后通知界面，更新资料列表、正在阅读的文档、图片引用与 Git 状态；不再等待整个 Agent 任务结束 |
| 编辑与版本交互 | Markdown 阅读、全屏/侧栏编辑、原生软键盘避让、未保存保护、逐行差异预览 |
| 项目下的多对话 | 新建、切换、自动命名/重命名、归档与恢复；消息、草稿、附件引用和明确模型选择独立，项目文件与 Git 历史共享 |
| 连续对话 | 默认最多带入当前对话、同模式最近 12 次目标与回复，按模型窗口预留空间；数量可配置，不重放其他对话或旧工具调用 |
| TypeScript、ESLint、Vitest、Playwright | 已配置并验证核心流程 |
| Pi Agent Core 1.1.0 | 已接入；上游核心未修改，Metro 使用纯工具函数入口 |
| 架构重构、多 Agent 与子 Agent | [新架构方案](architecture-v2.md) 实施中；R0–R2 分层、职责拆分、运行仓库/迁移、队列、共享预算、请求池与恢复已接入实际执行；R3–R5 未完成，当前仍限制一个活动根任务，不支持子 Agent |
| SQLite 与文件持久化 | Android 模拟器已验证；浏览器使用 IndexedDB；arm64 真机/iOS 待验证 |
| 模型密钥持久化 | Android SecureStore 保存后强制停止重开调用通过；iOS 待验证 |
| SQLite schema | 原型为版本 1 的 records(bucket,id,payload) 表；第 7 节规范化 schema/FTS 未实现 |
| 本地 Git 工作流 | 已实现真实工作区/index/HEAD 分离、按文件暂存/取消暂存、差异/明确提交、Agent 受控 Git 工具、内部恢复点、任务快照/冲突撤销；[实施设计](git-workflow.md)；分支/合并/远程/逐块暂存待实现 |
| Android/iOS libgit2 构建与原生桥接 | 待实现 |
| 模型调用与 Agent 循环 | Chat Completions、Anthropic Messages、Gemini 原生 REST/SSE 已实现；三协议模拟工具闭环与图片输入通过；DeepSeek 前版已做官方实测 |
| 服务配置与诊断 | 独立连接与凭证、预设/自定义协议、分页发现、手工模型、文本/工具/图片检测；分平台保存检测结果 |
| 远程 MCP | Streamable HTTP、两代协议协商、Bearer/无需认证、工具发现与项目授权、Pi 执行/进度/轨迹、未知回执与重试限制；[实施设计](remote-mcp.md)；OAuth/Resources/Prompts/Tasks/MCP Apps 尚未实现 |
| Agent Skills | 标准 SKILL.md/ZIP 导入、本地编辑/资源/历史恢复、项目启用、目录/正文/资源渐进加载、明确调用与任务 Git 版本快照；[实施设计](agent-skills.md)；脚本执行与远程市场尚未实现 |
| 多供应商/模型配置器 | [实施记录](provider-model-configurator.md)；多连接、多模型、能力依据、参数、收藏、分层默认与运行快照已实现；Anthropic/Gemini 官方实测待凭证 |
| 任务运行配置 | 启动时冻结服务/模型/参数版本，凭证通过宿主租约使用；界面关闭或切换配置路由不停止任务 |
| Agent 设置 | 全局系统提示词与执行预算可编辑、恢复默认并持久化；任务保存启动时配置版本，修改只影响新任务 |
| 工作轨迹 | 所有轮次的文字、公开推理与工具执行按接收顺序交错显示；推理和工具详情可折叠，旧任务保留兼容显示 |
| 推理配置与展示 | DeepSeek 开关、Anthropic 预算/自适应、Gemini 预算/等级已接入；原生公开摘要和兼容协议推理流已模拟验证；新推理路径的官方实测待凭证 |
| 对话持久化与迁移 | conversations/state 保存实体、最后选择和版本化草稿；任务保存 conversationId/draftRevision；旧历史迁入原有对话并保留原模型 pin |
| 配置迁移与恢复 | 原单配置迁移为连接与模型；SecureStore 凭证采用可恢复操作意图，旧凭证待配置提交和运行租约释放后清理 |
| 操作日志与崩溃恢复 | 文件/Git/元数据协调已实现并做失败注入；原生掉电/fsync 保证待验证 |
| 任务恢复 | 启动时修复文件一致性并标记 interrupted；不自动续跑模型，不重放未知远程请求 |
| 图片 | 导入、预览、历史对比、可选模型输入已实现；裁剪、缩放、生成尚未实现 |
| IntelligentUI、网页沙箱 | 后续阶段 |

演示模式使用显式预设传输，不进行语义理解；它经过真实 Pi 工具循环和工作区写入，结果保持未提交。真实模型模式由用户配置地址、模型和密钥，只有明确要求提交才使用 Git 工具。详细使用与限制见 [prototype.md](prototype.md)，验证见 [validation.md](validation.md)。

对话与项目是独立实体，通过 projectId 关联。任务与 transcript 归属于具体 conversationId；对话间不隐式带入聊天历史，但可通过受控工具读取同一项目的共享资料。模型按对话选择 → 项目默认 → 全局默认解析，明确选择演示/真实模式也按对话保存。当前仍为一次运行一个任务；其他对话可切换、阅读和准备草稿，文件写锁继续作用于项目。

旧任务缺失 conversationId 时迁入稳定的 projectId:main 对话，保持既有模型选择 ID。迁移先提交对话图，再逐条补写任务，失败后可重复执行。草稿使用递增版本；任务启动记录对应版本，提交后只清理匹配版本，重启可修复“任务已保存、草稿未清理”的中断，不清除后来编辑的新草稿。草稿显示保存状态，进程中断只能恢复最后成功写入的内容。

归档保留对话、消息、草稿和模型选择，最后一个对话归档时建立新的空对话。运行对话持有宿主租约，归档会被拒绝；切换对话不改变执行对象。永久删除、多任务并发、对话分叉和跨项目移动尚未实现。

### 工作轨迹与公开推理

TaskRecord.trace 是有序的文字、推理与工具节点数组。节点保存稳定 ID、轮次、开始/结束时间、状态；内容用本轮 contentIndex 定位，工具用本轮 toolCallId 定位。增量更新原节点，不把不同轮次的文字拼成最终答案。response 继续保存最后一轮文字，供轻量上下文与旧调用者使用；events 保留旧格式兼容。

UI 按数组顺序展示过程说明 → 推理/摘要 → 工具 → 下一轮说明，不把工具集中到顶部。推理默认折叠，运行中显示生成状态与内容预览；工具可展开输入、结果、耗时，详情截取前 6,000 字符。收起整个轨迹后仍展示最后一轮回复。演示只展示显式预设过程说明，不伪造推理。

模型参数允许关闭、服务默认和开启。DeepSeek 映射 thinking.type；Anthropic 映射 enabled/budget_tokens 或 adaptive；Gemini 映射 thinkingBudget 或 thinkingLevel 并请求 includeThoughts。参数格式由用户按模型支持范围明确选择，不从模型名称猜测。Anthropic 开启推理时温度必须留空，预算至少 1,024 tokens 且小于输出上限。通用 Chat Completions 没有统一开关，当前不开放强制开启，只读取 reasoning_content、reasoning、reasoning_summary；“关闭”仅表示不主动请求推理。部分原生模型不能关闭推理，需要选择服务默认。

### Agent 设置与长任务预算

“设置 → Agent 设置”提供全局系统提示词、最大模型请求轮数、工具调用次数、任务总时长、单次请求超时与历史任务数量。提供分别恢复默认提示词/预算的按钮，以及未保存离开保护。提示词最多 16,000 字符，不允许空白；工作区规则由宿主另行注入，编辑提示词不能改变受控工具的路径、版本和权限约束。

settings/agent 是 SQLite 元数据中的单条原子记录，保存 schemaVersion/revision/systemPrompt/limits。旧安装没有记录时采用新默认预算，无须改变任务或文件 schema。保存失败保留上一版本，串行保存检查 expectedRevision，防止旧页面覆盖较新的配置。Zustand 不保存这些业务设置。

TaskRecord.agentSettingsSnapshot 冻结任务开始时的提示词、配置版本和预算；修改设置或切换配置页面不改变已启动任务的任一后续请求。旧任务没有该快照时不补造配置。默认历史数量由 6 提升到 12，允许 0–50；仅携带本对话同模式的最终目标/回复，按模型窗口的一半预留当前提示词/任务空间，并保守限制历史字符量。该估算不等于 tokenizer，当前任务的自动摘要压缩尚未实现。

达到模型轮数、工具次数或任务时长时，任务记录明确列出相应上限和调整入口；总时长到期属于预算耗尽的 failed，用户主动停止仍为 cancelled。模型 length 返回提示调整对应模型输出或分段处理，已有文件与 Git 修改保留。

### 资料实时更新

WorkspaceService 在项目创建或文件/暂存/提交操作完成并记录 recorded 日志后，发布只包含 projectId/相对路径/commit 的宿主变更通知；commit 是实际 HEAD，不是内部恢复点。普通文件操作完成内部检查点，不自动提交。任务是否结束不影响通知；重试已 recorded 的操作不重复通知，恢复补记完成后也可发布。观察者异常与写入隔离，不能把已成功的修改错误标记为需恢复。

工作台订阅当前项目的变更，在读刷新期间合并新通知并继续读取最新状态，不按模型 token 轮询。后台其他项目的文件变更不替换当前资料；切回项目时读取最新版本。任务结束仍刷新任务终态。退出工作台退订并作废在途读取，导航与项目切换通过请求序号防止旧结果覆盖新项目。

任务开始时先切到会话，再启动异步执行；启动完成的回调不再次强制切换标签。用户发送后切到资料或版本，可以停留在所选页面查看实时结果。

文件列表、Git 版本、已 recorded 操作与打开文件的预览通过项目队列中的只读快照取得；快照等待前一个文件操作完成，后续写入等待快照读取结束。移动、批量恢复过程中不把“部分路径已应用、提交尚未结束”的中间状态作为实时成功结果展示；这不改变 Git/SQLite 不具有跨存储事务的事实。

无未保存修改的打开文档自动刷新文字/图片与修订号；文件移动或删除后关闭原路径的只读预览。存在未保存的正文/名称时保留当前草稿并标记 externalChanged，不静默覆盖。编辑状态的 ref 与界面更新同步，防止异步读取覆盖刚输入或刚关闭的文档。Markdown 图片加载以项目图片修订列表失效，图片移除后显示不可用，旧加载结果不会重新显示已删除图片。

“实时”以成功保存的文件版本为边界；尚在生成、尚未通过工具写入的文本仍展示在工作轨迹中，不作为已保存资料。当前仍不监听应用外部进程的文件变化，跨浏览器页面协作也未实现。

可见性依据服务公开输出与明确展示声明：DeepSeek/通用兼容协议默认“思考过程”，Anthropic/Gemini 默认“推理摘要”；显式 reasoning_summary 永远标记摘要。展示声明只影响标签，不改变模型输出，不保证内容是完整思维链。模型开源与否不能决定 API 是否公开推理。缺失内容显示“服务未返回可展示的推理内容”，redacted_thinking 显示未公开；不要求闭源模型泄露隐藏思维链，不用普通说明冒充推理摘要。

Opaque thinkingSignature/thoughtSignature 仅保留在宿主 transcript/协议上下文中，满足工具后续轮回传；轨迹 DTO 不包含签名、密钥、图片 base64 或原始 HTTP 响应。进程重启后不自动续跑；仅收束仍运行的节点为 interrupted，已完成节点保持状态。旧任务缺少交错顺序时明确标注，不从最终回复推造历史推理。

流式任务快照约 200ms 合并一次，并在消息/工具边界和结束时落库；所有检查点串行写入不可变副本，最终保存等待队列完成，避免旧异步写覆盖终态。进程被强制停止时，只保证最后成功持久化的增量；Git/文件恢复继续独立执行，不把轨迹存储宣称为跨存储事务。

## 3. 已选技术栈与架构决策

| 层 | 选择 | 理由 |
| --- | --- | --- |
| 客户端 | React Native + Expo Development Build | 双平台、快速开发，可接入自定义原生模块 |
| 语言 | TypeScript strict | 共享协议与领域类型 |
| 路由 | Expo Router | 文件路由与页面组织 |
| UI 状态 | Zustand | 当前选择、输入草稿、显示进度 |
| 图标和差异显示 | Lucide / react-native-svg、diff | 按需导入 SVG 图标；展示文本逐行变化 |
| 数据库 | expo-sqlite，WAL，FTS5 | 任务状态、会话、元数据、全文搜索 |
| 工作区磁盘访问 | expo-file-system | 私有目录内真实文件 |
| 文件历史 | 原型 isomorphic-git；目标 libgit2 原生模块 | 原型先验证 Git 格式及恢复；后续替换 Git 适配器 |
| 输入校验 | Pi 工具采用 TypeBox；Zod 留作业务/UI schema | 避免重复维护工具 schema |
| 模型通信 | expo/fetch + 自有兼容 SSE 传输 | 作为 Pi streamFn 注入，避开 Node 供应商 SDK |
| 图片 | expo-image、image-picker、image-manipulator | 导入、显示和基础变换 |
| 文件导入和分享 | expo-document-picker、expo-sharing | 使用系统授权入口 |
| 凭证 | expo-secure-store | Keychain/Keystore 支持 |
| 网页 | 后续 react-native-webview | 分阶段开放网页交互 |

Router 所需的 Reanimated、Worklets 和 Gesture Handler 采用 Expo SDK 兼容版本显式锁定；避免传递依赖自动解析到不兼容的 Worklets。初始化的实际检查结果见 [validation.md](validation.md)。

依赖以 package-lock.json 为准；Expo 原生包通过 expo install 选择兼容版本。不使用 canary/next 版本作为默认基线。

主要决策：

1. 虚拟文件系统是受控逻辑 API，底层保留真实目录，便于 libgit2 使用。
2. Git 是文件版本历史的来源，不再另建一套内容寻址版本库。
3. SQLite 是运行状态和业务元数据的来源；文件索引和搜索索引可以从磁盘重建。
4. Agent core 不依赖 React、Expo、Node.js、原生模块，平台能力通过接口注入。
5. 单 Agent 执行循环复用 Pi Agent Core 1.1.0；任务协调、预算、持久化、权限与恢复属于宿主。
6. 首版无需服务端；统一模型额度和账号服务确定后再加 Node.js/TypeScript 后端。
7. 原生工程采用 Expo Prebuild 生成；持久源码放在 modules 和 config plugin。

原型适配补充：Pi 默认 pi-ai 根入口包含 Metro 无法静态解析的 Node 动态导入。metro.config.js 将该根入口映射到 src/adapters/agent/pi-ai-mobile.ts，仅转出上游公开的 transcript/event-stream/json-parse/validation 子路径。没有修改 node_modules，也没有复制或 fork Agent Core。

isomorphic-git 使用官方浏览器构建及自定义 fs 适配，避免 sha.js 的 Node stream 依赖。移动端落盘到应用私有目录；浏览器预览把相同的 Git 文件和业务记录分别存入 IndexedDB。Git 工程本身仍是标准仓库格式。

## 4. 模块结构

```mermaid
flowchart TD
  UI[聊天、工作区、编辑器、修改预览] --> H[Agent 执行器与任务协调器]
  H <--> M[ModelPort / 供应商适配]
  H --> T[工具注册与权限校验]
  UI --> W[WorkspaceService]
  T --> W
  W --> F[真实工作区文件]
  W --> G[GitPort / Expo 原生模块 / libgit2]
  W --> D[SQLite / 操作记录 / 索引]
  H --> D
  R[未来 IntelligentUI / WebView] --> T
```

src/core：领域接口、执行状态机、上下文策略、工具协议。不保存明文密钥，不直接打开文件。

src/adapters：文件、数据库、Git、模型、凭证、图片适配器。向领域层返回统一结果和错误，不泄漏平台绝对路径。

src/features：后续按工作区、会话、编辑器、历史、设置组织业务界面。路由文件只组装页面。

modules/agent-git：未来本地 Expo 模块。Git 操作在线程池或专用队列执行，不阻塞 JS/UI 线程。

本次的接口是最小起点，尚未覆盖所有 CRUD、历史恢复和搜索功能。新增接口应与实际实现一同提交。

## 5. 工作区与权限模型

每个项目对应应用私有目录内的真实 Git 仓库。用户外部文件经系统选择器授权后复制进入工作区；首版不直接修改外部文件或长期持有任意目录访问权。

```text
app-private/
  state/
    app.sqlite
  workspaces/
    <workspace-id>/
      repository/
        .git/
        documents/
        assets/
        project.json
      runtime/
        staging/
        recovery/
        thumbnails/
```

project.json 可保存可移植的项目名称和格式版本；数据库、会话、运行日志、缓存、凭证和临时文件不进入 repository。

逻辑路径使用相对路径和正斜杠。空字符串仅用于表示工作区根目录；文件操作要求非空路径。

宿主与原生模块共同实施：

- 拒绝绝对路径、盘符、URL、空字节、父目录跳转和保留路径。
- 规范化后验证路径仍位于目标根目录；检查大小写、Unicode 和目录边界。
- 禁止访问任何层级的 .git，不允许创建符号链接或经已有链接跳出根目录。
- 模型只获得 workspaceId 和受控相对路径，不能选择应用任意私有目录。
- 每次工具调用检查任务能力范围、文件类型、文件大小和基础版本。
- Git 桥接只接受宿主管理的 workspaceId；原生侧解析目录，不信任 JS 提供的绝对路径。
- 项目内允许的读写默认自动执行；访问其他项目、发送额外资料、扩大权限由宿主决定并展示给用户。

文件修订号使用当前字节内容的摘要，与 Git commit OID 分开。写入携带 expectedRevision；创建时使用 null 表示文件必须不存在。冲突返回 VERSION_CONFLICT，不静默覆盖。

首版同一工作区仅一个写入者。用户可查看内容；编辑前需要暂停任务并完成恢复/检查点，或把用户修改排入同一写队列。不同项目可以独立排队，模型请求总并发仍受限制。

工具错误至少区分：NOT_FOUND、INVALID_PATH、ACCESS_DENIED、VERSION_CONFLICT、UNSUPPORTED_TYPE、QUOTA_EXCEEDED、INTERRUPTED、STORAGE_ERROR。错误信息不得含凭证。

## 6. Git 集成和版本语义

### 6.1 目标原生集成（尚未实现）

Android：TypeScript → Expo Modules API（Kotlin）→ JNI/C++ → NDK/CMake 编译的 libgit2。

iOS：TypeScript → Expo Modules API（Swift）→ Objective-C++/C → 静态库或 XCFramework 中的 libgit2。

两端固定同一稳定版本；Android 首先验证 arm64-v8a 真机和 x86_64 模拟器，是否支持其他 ABI 由最低机型范围决定。每次原生集成升级都记录源码版本、编译参数与许可证。

首版只启用本地仓库功能，关闭不需要的远程传输依赖。以后 HTTPS/SSH、认证和证书验证独立设计。Android NDK 使用当前 CMake 工具链，不直接照搬 libgit2 README 中的旧 standalone GCC 示例。

原生调用返回结构化错误并正确释放资源；同一仓库的 index、refs 和写操作串行化。TypeScript 层不暴露 git shell 命令或任意底层函数。

libgit2 默认访问真实文件系统。使用 SQLite 虚拟 blob 作为唯一文件存储会增加适配成本，本项目不采用该路线。

原型使用 isomorphic-git 实现真实仓库、index、显式提交和独立引用检查点，通过标准 Git CLI 验证 HEAD/index/工作区。文件修订号采用 Git blob OID。任务同时记录公开 HEAD 与工作区/index 快照。libgit2 替换、后台线程性能和两端原生 ABI 验证保留为下一阶段。

### 6.2 用户可见版本

- 创建项目时初始化仓库并提交 project.json 与初始笔记，保证初始 HEAD 存在。
- 明确保存只修改工作区。暂存把选定文件当前字节冻结到真实 index；取消暂存还原该路径的 HEAD index 项，不改工作文件。
- 用户填写说明后提交暂存内容；暂存后继续编辑的内容保持未暂存。Agent 只能暂存/提交本任务修改且任务开始前干净的文件，可选择提交路径，保留其他用户暂存更改。
- 任务允许带未提交内容启动；记录 baseCommit/baseSnapshot/baseIndexSnapshot，结束记录 finalCommit/finalSnapshot/finalIndexSnapshot。没有提交也能展示任务前后文件差异。
- 内部检查点位于 refs/agent-mobile/checkpoints，不进入普通 HEAD 历史；旧版公开提交保留，不自动重写或压缩。
- 任务撤销仅恢复任务涉及路径及原暂存状态；校验这些路径没有后续工作区/index 修改，其他路径保留。已有提交历史保持不变，撤销结果可自行再提交。
- 历史预览显示父提交 → 所选提交；历史恢复要求干净工作区/index，把目标完整内容放回工作区，不自动产生恢复提交。

“整次撤销”不删除会话和执行记录。文件重命名在界面按新增与删除显示，标准 Git 可启发式识别重命名；SQLite 操作记录保留真实动作供界面展示。逐块暂存、分支、合并、远程 Git 与容量清理尚未实现。

图片的版本对比显示前后预览、尺寸和大小，不承诺像文本一样逐行合并。图片变化可能增加接近整张图片的存储量；暂不引入 Git LFS。

Git 历史不是备份。当前可导出单文件；完整项目/仓库包和会话备份尚未实现。删除当前文件不会立即删除 Git 历史或内部检查点中的内容，永久清除需要后续独立功能。

## 7. SQLite 数据设计

迁移按递增 schema version 执行，启用 foreign_keys 与 WAL；确认所选构建中 FTS5 可用。数据库内容不纳入工作区 Git。

| 表 | 主要字段 | 责任 |
| --- | --- | --- |
| workspaces | id、name、relativeRoot、schemaVersion、createdAt | 工作区注册，根目录为相对位置 |
| files | workspaceId、path、kind、mimeType、revision、sizeBytes | 当前文件索引；可重建 |
| assets | id、workspaceId、path、width、height、sourceAssetId | 图片引用和派生关系 |
| conversations / messages | id、workspaceId、role、parts、toolCalls | 用户可见会话与模型协议记录 |
| runs | id、workspaceId、state、baseCommit、checkpointCommit、limits | 持久化任务状态 |
| tool_executions | operationId、runId、modelCallId、toolName、state、result | 幂等执行与恢复 |
| operations | operationId、phase、beforeHash、afterHash、recoveryPath | 跨文件/Git/DB 操作记录 |
| versions | workspaceId、commitOid、runId、kind、createdAt | Git 版本的业务关联 |
| file_search | workspaceId、path、text | FTS5 搜索索引；可重建 |

凭证仅存 SecureStore，SQLite 保存供应商配置和凭证引用。数据库保存的是可解释的执行摘要、工具参数和结果，不依赖供应商私有思考内容。

会话消息、图片资源和工具执行记录可能很大，需要分页读取；工具结果限制长度，完整大结果通过资源引用访问。

## 8. 文件、Git 与数据库的一致性

三者没有共同事务。不能假设“文件写入成功”与“数据库提交成功”同时发生。使用持久化操作记录和可重入的恢复流程。

一组修改的执行步骤：

1. 获得工作区写锁，检查预期 HEAD、文件修订号和空间预算。
2. 在 SQLite 中记录 prepared 操作：受影响路径、前后摘要、恢复位置、所属任务。
3. 原型在日志保存完整前后字节，index/commit 意图使用不可变 Git 对象；原生 staging 与原子替换属于后续目标。
4. 通过平台适配器写入/移除目标文件，更新 applied 阶段；界面快照等待整批操作完成，不展示半完成批次。
5. 根据 operation.kind 分别执行：files 只创建内部工作区检查点；index 应用已冻结的 indexChanges；commit 提交已冻结的树，提交中附带宿主生成的 operationId 标记。旧版无 kind 日志继续原自动提交恢复。
6. 在 SQLite 原子记录中保存检查点/commit OID、index 前后版本与下一阶段，标记 recorded。原型记录完整前后文件字节作为恢复意图，原生原子文件替换仍是后续目标。
7. 释放锁；确认相关记录可恢复后清理临时内容。

一个任务通常由多组修改组成；每组修改都能恢复。多文件批次在崩溃瞬间不具备文件系统层的全局原子性，通过锁、日志和启动恢复向应用提供一致状态。

恢复时先冻结该工作区，检查实际文件摘要、Git HEAD、提交标记和数据库记录：

| 中断位置 | 恢复行为 |
| --- | --- |
| prepared 后、文件尚未改 | 丢弃未应用内容，或验证后继续 |
| 文件或 index 已改、内部检查点尚未记录 | 验证 before/after 后完成原操作与检查点；不再次调用模型生成修改，不自动创建用户提交 |
| Git 已提交、SQLite 尚未记录 | 按 operationId 查到提交并补记结果，禁止重复提交 |
| 日志与磁盘无法对应 | 标记待处理，保留恢复数据并提示用户，不盲目覆盖 |

如果底层文件 API 无法提供需要的持久化/替换保证，在原生模块补充实现。实现阶段必须做进程终止、磁盘不足和跨存储失败验证。

operationId 由宿主持久化生成；模型 toolCallId 用作关联，不能独自作为跨模型重试的幂等键。

## 9. Agent harness 与模型适配

本节状态图与 ModelPort 是早期目标说明，不代表当前所有状态均已实现。后续运行内核、父子任务、权限、预算和引擎边界以 [architecture-v2.md](architecture-v2.md) 为准；当前实际使用 Pi Agent Core、TypeBox 工具参数校验，以及第 2 节列出的任务状态与功能。

任务状态：

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> running
  running --> waiting_user
  waiting_user --> running
  running --> paused
  paused --> recovering
  recovering --> running
  recovering --> waiting_user
  running --> completed
  running --> failed
  running --> cancelled
  recovering --> failed
```

queued 等待执行资源；waiting_user 等待确认或解决冲突；paused 表示已记录中断点。应用启动发现非终态任务时，先进入恢复流程，不能把 SQLite 中残留的 running 当作还在运行。其他非终态也可根据用户操作取消或失败。

执行循环：

1. 获取用户目标、工作区权限和基线版本，持久化任务。
2. 从文件、搜索结果、任务摘要和最近消息组装上下文。
3. 请求支持工具调用的模型，流式更新可见回复。
4. 只在完整参数接收并通过 Zod 校验后执行工具；不执行半截流式 JSON。
5. 检查权限、预算、取消状态和文件修订号，按写队列执行并记录结果。
6. 把有限的工具结果交回模型，继续下一轮。
7. 完成时保存版本并展示成果、修改清单和实际使用量。

最初工具集合：

| 工具 | 行为 |
| --- | --- |
| list_files / read_text / search_text | 获取指定内容，支持分页/范围 |
| create_directory / write_text / apply_text_edit | 受控创建和版本检查写入 |
| move_file / delete_file | 保留可恢复版本，检查目标冲突 |
| inspect_image / transform_image | 按 assetId 读取；变换生成新资源 |

版本提交、回滚和权限扩展属于宿主动作，不把 reset、checkout、任意 Git 命令交给模型。基础工具不包含任意联网、shell 或代码执行。

ModelPort 归一化消息、图片引用、完整工具调用、文本增量、使用量和结束原因。供应商适配器处理资源读取、图片上传/编码、认证与错误转换。任何图片 URL 都不能直接变成任意网络读取。

“兼容某种 API 格式”不代表所有能力一致。每个供应商/模型单独声明 imageInput、toolCalling，并通过真实请求验证。未返回实际 token 用量时展示估计值或未知。

上下文仅包含当前任务相关文件；文本搜索先使用 FTS5 和路径过滤，图片按需缩放输入；暂不引入向量数据库。压缩上下文保留文件引用、版本和已完成动作。

原型实际默认预算（2026-10-14 提升）：最多 50 轮请求、200 次工具调用、20 分钟任务墙钟、5 分钟单次流式请求；设置页可分别调到 200 轮、2,000 次、120 分钟和 30 分钟，单次超时不得大于任务总时长。目录请求仍为 60 秒，诊断仍为 30 秒且保持低生成额度。

新模型默认单轮输出 8,192 tokens，可配置至 65,536，仍受服务公布的输出上限约束；已有模型参数保留原值。SSE 原始响应 4 MB，请求 JSON 的 UTF-8 长度 8 MB，单轮最多 32 个工具调用。文本文件 1 MB、单次工具文字最多 240,000 字符，文件导入 20 MB、模型图片输入 4 MB，像素上限仍为 2,400 万。read_text 默认每页 12,000 字符，支持 offset/length，返回 totalCharacters/truncated/nextOffset；文件修订号仍对应完整文件。文本搜索最多 100 条片段。

这些是宿主保护上限，不能突破供应商的上下文、输出、图片或限流约束。精确 token 预算、自动摘要压缩、配置化文件阈值和缩图输入仍待实现。超限结束并保留检查点，不无限重试。

断网与远程超时要区分请求未发送、已发送但结果未知和已返回。只能保证本地可验证操作不重复；不能承诺远程请求绝对 exactly-once 或不会重复计费。后续图片生成需供应商幂等键或可查询 jobId，未知结果不能盲目再次提交。

取消时中止网络请求并阻止新工具操作，已进入不可分割写入阶段的动作先完成或恢复到检查点。取消不自动撤销已完成修改；界面提供保留结果或恢复任务基线的明确选择。

## 10. 文本、图片与用户交互

首版文本采用 UTF-8；Markdown 图片链接使用工作区相对路径。现有前端使用原生组件安全展示基础 Markdown（标题、列表、引用、加粗、代码文本与本地图片），不执行 HTML，也不自动加载外部图片。复杂表格、公式等仍待实现。

导入图片时复制原件、记录 MIME/尺寸/大小，生成缩略图。基础变换写到新路径，记录 sourceAssetId；用户选择替换显示引用时仍保留原件和 Git 历史。

图片输入和变换按文件大小及像素数量限制，避免解码超大图片导致内存峰值。大文件下载和复制走流式或原生路径，不通过 JS 层反复传递整文件 Base64。

首版页面规划：

- 工作区：项目列表、文件浏览、导入和创建。
- 会话：任务目标、执行状态、取消/暂停和结果。
- 编辑器：文本编辑、图片预览、受控修改。
- 修改预览：按文件显示新增/修改/删除，文本 diff 和图片对比。
- 历史：用户版本与任务版本，恢复预览。
- 设置：模型、凭证、使用预算、空间、导出。

当前交互：手机使用“会话/资料/版本”底部导航，会话输入框固定在底部；桌面使用项目侧栏与编辑侧栏。未保存编辑关闭、切项目或新建项目之前提供保存/放弃选择；恢复版本前预览逐行差异；原生开发菜单不再启动时覆盖界面或悬浮遮挡设置入口。

主题包含跟随系统、浅色与深色。主题和上次选择的项目保存在偏好记录中，模型连接仍通过独立草稿保存。原生源码相关配置保存在 plugins/with-dev-menu.js，可通过 Prebuild 重建。

项目内常规动作自动执行，任务结束展示成果和可撤销变化。费用、访问范围扩大、清空历史等操作需要清晰的用户决策；不把每个内部小步骤都变成确认弹窗。

导出用户选择的文件或内容包，通过系统分享交付。内容包默认不包含 .git、会话和私有运行记录；完整仓库导出属于单独选项。

## 11. 手机生命周期、隐私与容量

首版以可见前台任务为主要运行方式，切后台先保存状态。按 OS 能力争取完成当前必要操作，但不承诺锁屏后持续运行。

expo-background-task 适用于系统调度的延后工作，不能替代交互式 Agent 的常驻执行器。未来如需 Android 前台服务或 iOS Continued Processing Task，单独开发原生适配和进度展示。

每一步都可中断，重新打开应用先恢复一致性，再让用户继续任务。后台通知、推送和后台模型任务不属于首版必需项。

凭证不进入日志、模型上下文、Git 或网页。首版私有目录和 SecureStore 是基础隔离；数据库和项目文件尚不等于应用层加密。若增加 SQLCipher，仍需同时设计图片、文本文件和备份的加密策略。

选择云模型时明确说明会发送哪些内容；图片 EXIF 保留、去除和外部服务保留策略在实现时确定。导入的文档/图片文字都是资料，不能因此获得工具权限或改写宿主规则。

容量指标分别统计当前文件、Git 历史、缓存和恢复数据。缓存可重建；历史和恢复数据不能随意当缓存清理。预留写入空间并在不足时提前拒绝，不删除旧版本来勉强完成一次写入。

应用卸载可能删除工作区；本地 Git 不提供跨设备灾备。首版必须有导出入口，后续再设计备份/同步。

## 12. IntelligentUI 与网页演进

第一阶段：模型返回受 Zod/JSON Schema 约束的 UI 描述，宿主映射到内置列表、图库、表单、表格、版本对比组件。限制组件数量、嵌套和资源大小。

动作只引用已注册 action ID，参数仍走权限、预算和版本校验。UI 状态与业务状态分离，页面重建不重复执行动作。不使用 eval 执行生成的组件代码。

第二阶段：渲染静态 HTML/CSS 成果，图片只引用宿主批准的资源；禁用脚本、外链导航和默认网络请求。

第三阶段：受控 WebView JavaScript 沙箱。独立处理源隔离、资源 URL 映射、网络白名单、导航/下载限制、消息桥接、会话能力 token、请求关联和生命周期。不能只依赖 iframe sandbox 或 originWhitelist 来限制所有网络通道。

默认没有相机、麦克风、通讯录、任意文件访问或模型密钥。网页动作仅通过有限的宿主消息协议访问授权资源；页面切换和销毁后撤销能力。任何阶段都不允许网页直接调用 Agent 运行时或底层原生 API。

网页异常、无限循环和过量资源请求不能破坏宿主工作区。具体隔离能力需要按 Android/iOS WebView 验证。

iOS 动态软件方案在进入实现前核对 App Store 规则 2.5.2 和 4.7，包括原生能力桥接与分发方式；技术可运行不意味着审核必然通过。

## 13. 实施顺序与验收

### M0：工程初始化（本次）

交付工程、依赖锁定、启动页、模块接口、设计文档。类型检查、Lint、Expo Doctor 和 Web 打包通过；原生编译与功能验证单独记录，不用 Web 结果代替。

### M1：本地工作区与 Git 技术验证

实现 SQLite 迁移、文件服务、系统导入和文本编辑；先打通 Android libgit2 的 init/status/commit/diff，再验证 iOS 相同接口。

验收：创建项目、导入文字/图片、修改并提交、查看差异、恢复后重新提交。路径越界和符号链接被拒绝，版本冲突不覆盖，磁盘不足不损坏原内容。

Git 是已选方案；若构建验证失败，记录具体问题并评估解决方案，不静默替换为伪 Git。

### M2：Agent 最小闭环

接通一个图片输入/工具调用模型，实现上下文组装、持久化工具结果、任务写锁、结果预览和整次撤销。

验收：用固定的一组图文资料完成整理与二次修改；检查被改文件及版本对应；只发送授权内容；非完整/非法工具调用不执行；超限停止。

### M3：恢复、容量与双平台可靠性

在文件应用前后、Git 提交前后和数据库更新前后注入失败；测试弱网、切后台、进程终止、取消和空间不足。

验收：本地已完成动作不因恢复重复执行；未知远程请求被识别；恢复后文件/Git/DB 对应一致；单工作区写入不交错。模拟器测试之外必须覆盖两端真机。

### M4：IntelligentUI 与网页试验

先完成结构化 UI，再分别验证静态网页和受控脚本。独立进行桥接、网络、导航和资源耗尽测试，并确认 iOS 上架方案。

测试重点放在权限、数据一致性、模型协议解析和中断恢复。轻量 UI 布局不需要为每个组件建立镜像实现的测试。后续领域逻辑可选用 Vitest，移动端关键流程再选择 Maestro 等端到端工具。

## 14. 待明确的问题

| 问题 | 当前基线 |
| --- | --- |
| 最低系统版本与目标机型 | 跟随 Expo SDK 支持范围，发布前按依赖和真机结果固定 |
| 模型供应商 | DeepSeek 前版已实测；Anthropic/Gemini 原生已实现并模拟验证，官方实测待凭证 |
| 模型商业模式 | 原型采用用户自带 Key；统一额度后端另行设计 |
| 大图片和历史容量上限 | 通过真机内存和典型项目测量确定，避免随意设定承诺 |
| 发布包标识 | 暂用 com.agentmobile.app，上架前替换 |
| 文本编辑器与 Markdown 渲染库 | M1 按移动端输入、性能和安全预览验证后选择 |
| 历史清除、备份与同步 | 首版导出；永久清除和同步后续独立设计 |
| 应用商店许可与第三方声明 | 集成 libgit2 和发布前完成依赖许可记录 |

## 15. 参考资料

- [Expo Development Builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo 本地原生模块](https://docs.expo.dev/modules/get-started/)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/)
- [Expo Fetch](https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api)
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [Expo Background Task](https://docs.expo.dev/versions/latest/sdk/background-task/)
- [libgit2 README / Android](https://github.com/libgit2/libgit2#android)
- [Android NDK CMake](https://developer.android.com/ndk/guides/cmake)
- [Android 存储](https://developer.android.com/training/data-storage)
- [Android WebView 原生桥接风险](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)
- [Apple Continued Processing Task](https://developer.apple.com/documentation/backgroundtasks/bgcontinuedprocessingtask)
- [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
