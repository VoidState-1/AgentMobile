# 测试、故障排查与维护操作

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                                    |
| -------- | ------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| 1.3.0    | 2026-10-18T19:00:33+08:00 | 34f542b6f4e917f475d36c9f5ea8b369f5d74dda | 同步尚未提交源码：增加文档状态/安全/中断恢复与 Web/Android 编辑器回归入口。 |
| 1.2.0    | 2026-10-17T10:27:05+08:00 | ba5117e2ea7908376dec70267b60d3b5d95f5156 | 同步尚未提交源码：字节保留、移动故障恢复与原生 SDK 模拟验证范围。           |
| 1.1.0    | 2026-10-17T00:09:49+08:00 | fd29c75e38d245b3a8e5cfb6a93c0b2156029d22 | 同步尚未提交源码：增加精确替换、协议回合、幂等及故障恢复回归入口。          |
| 1.0.1    | 2026-10-16T23:19:13+08:00 | 798aea13020fdad314b8a34bc78d7eadb2ac0bf0 | 同步尚未提交源码：测试使用外置模型协议 fixture，更新原生脚本前置服务说明。  |
| 1.0.0    | 2026-10-15T17:24:30+08:00 | 9ad009be8a41df28a02060c5620ee12a29c3d901 | 建立测试选择矩阵、平台/费用边界、故障排查与性能测量规范。                   |

## 1. 验证层次

| 层次               | 入口                                           | 可证明的范围                                                        |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------------------- |
| 类型/分层/领域单元 | `npm run check`                                | TypeScript、ESLint 和当前 Vitest 用例                               |
| 协议模拟           | Vitest fixtures、模型/MCP模拟服务              | 编码、流解码、工具回合、取消和故障行为；不证明真服务可用            |
| 浏览器端到端       | `npm run build:web` 后 `npm run test:e2e`      | Chrome、Web UI、IndexedDB 与模拟网络流程                            |
| 当前存储契约       | storage-current-format / storage-range 脚本    | 实际 SQLite SQL、IDB 范围查询和事务；Node bridge 不等于 Expo 原生桥 |
| Android UI/持久化  | android-* 脚本                                 | 指定模拟器 Development Build、Hermes、FileSystem/SQLite 使用与恢复  |
| 真实模型           | `npm run test:live` / Android live             | 指定 Key、供应商、模型、参数和平台的真网络结果，可能计费            |
| 性能采样           | architecture-measurement / android-measurement | 指定 fixture 与测量口径；不能泛化为发布性能承诺                     |

原生权限、安全存储、进程终止恢复和 Hermes 必须实际平台验证。iOS bundle 导出、Android x86_64 模拟器和 arm64 真机不可互相替代。

## 2. 常规检查

```sh
npm run check
```

该命令依次运行 typecheck、lint、test；任一步失败即不应宣称全部检查通过。Vitest include 为 `tests/**/*.test.ts`，不包括 Playwright `.spec.ts` 或 Android 脚本。测试数量随代码变化，维护记录写真实结果，不复制 Design 中旧数字。

依赖/Expo 配置变化另跑 `npx expo-doctor`；影响 Metro 解析或平台导入另跑 `npx expo export --platform all --output-dir work/prototype-export`。只修改文档不必发起付费请求或原生压力测试。

文档编辑回归运行 `tests/document-editor.test.ts`、`tests/e2e/document-editor.spec.ts`、text-files/workbench/workspace-live/git-workflow E2E。覆盖块手势、连续编辑、读写边界、上下移动、独立草稿、Markdown-it、安全资源、草稿修订与保存中断对账。

Android Development Build 安装并启动 Metro 后运行 `node scripts/android-document-editor.mjs <serial>`；脚本只新建隔离测试项目，验证真实 WebView、Android 输入、离开保护、force-stop 恢复及保存重开。调试构建的 WebView CDP 用于读取 DOM、选区和几何，触摸和键盘通过 adb 发送；发布构建关闭 WebView 调试。原生自动化同时识别 EditText 的 hint，因为 WebView 会将 aria-label 投影为 hint。

## 3. 按变更选择回归

| 变更                   | 必要重点                                                                       |
| ---------------------- | ------------------------------------------------------------------------------ |
| AppServices/分层       | app-services、architecture-boundaries；检查 facade 实际成员                    |
| 文件/路径/缓存         | workspace、file-read、workspace-live；同大小mtime变化、写前 revision、通知范围 |
| Git/index/操作日志     | git-workflow、journal；stage 后再编辑、重复操作、跨阶段中断、坏对象            |
| 存储/schema/原生持久化 | 当前格式脚本、run-repository、trace-storage；实际 SQLite/IDB 与原生恢复        |
| 内核/预算/调度/停止    | run-kernel、group-budget、request-scheduler、termination、pi-request-lifecycle |
| 委派/提案              | delegation、agent-grants、proposals；路径缩限、预算共享、取消传播、合入回执    |
| 模型协议/配置          | provider-protocols、model-config、model；任意流块、工具回合、签名与截断        |
| MCP                    | mcp、MCP E2E；两代协议、定义变更、派发前后取消、未知结果/回执故障              |
| Skills                 | skills、run-resources、Skills E2E；ZIP/YAML边界、更新撤权、运行冻结、保存中断  |
| 前端编辑/会话          | workbench、conversations、workspace-live、trace E2E；输入与导航竞态、主题/窄屏 |

文本批量编辑重点运行 [text-edits](../tests/text-edits.test.ts)、[text-edit-tools](../tests/text-edit-tools.test.ts)、[proposals](../tests/proposals.test.ts) 与 provider-protocols：覆盖唯一/重叠/原文定位、Unicode/换行、批量失败零效果、过期与并发、回执参数冲突、各日志阶段中断及候选恢复。Web workspace-live E2E 验证失败后重读纠错、实时刷新和重开持久化；这些模拟与 Web 检查不代替手机原生验收。

原始字节与存储边界重点运行 [workspace-bytes](../tests/workspace-bytes.test.ts)、[native-storage](../tests/native-storage.test.ts) 与 [通用文件 E2E](../tests/e2e/text-files.spec.ts)：覆盖 Git 配置路径、越界身份、二进制逐字节保留、内容识别、大文本策略、移动前/后/仅复制中断及未知内容阻断。native-storage 用模拟 Expo SDK 核对 File.move 的调用和禁止覆盖，不能证明真机进程中断、原生目录语义或设备性能。Web E2E 在 390px/1280px 验证二进制导入、改后缀仍不可编辑、下载字节一致，实际覆盖 IndexedDB moveFile 事务。

普通可逆文档/UI小修改不新增镜像实现的测试；接口、授权、持久化、恢复和竞态变更需要有行为证据。检查通过后不重复扩大测试，除非新变化或未解决疑点需要。

## 4. Web E2E

```sh
npm run build:web
npm run test:e2e
```

[playwright.config.ts](../playwright.config.ts) 使用 tests/e2e、默认 60 秒、1280×900 视口和本机 Chrome；具体用例会覆盖移动视口。自动启动 preview，或复用已有 4180 服务。若复用旧服务，确认它读取当前导出目录；测试不会自动编译最新源码。

大部分网络测试用 route/fixtures 模拟，出现“真实 Agent 上下文”等用例名称表示实际 Pi 循环，不代表生产供应商真请求。截图和输出在 work/playwright。

当前格式/范围验证可在预览服务可访问时运行：

```sh
node scripts/storage-current-format.mjs
node scripts/storage-range.mjs
```

默认预览 origin 在两个脚本中可能为 localhost/127.0.0.1；可用 PREVIEW_URL 明确指定。脚本使用新 browser context 和测试数据库，不接入已有用户浏览器 profile；SQLite fixture 位于 work/validation。结果不能代替手机 Expo SQLite bridge 验证。

## 5. Android 验证前置条件

使用**隔离测试模拟器**，先确认 serial、应用包、Development Build 和 Metro，设置 ANDROID_HOME，关闭开发菜单，保持源码不变。部分脚本会创建资料、操作 Git、force-stop，甚至导出/替换测试数据库或注入失败 trigger；不要运行在用户日常资料实例或外部服务数据上。

基础操作：

```sh
npm run test:android -- <serial>
node scripts/android-conversations.mjs <serial>
node scripts/android-agent-settings.mjs <serial>
node scripts/android-trace.mjs <serial>
node scripts/android-workspace-live.mjs <serial>
```

基础 smoke、conversations、agent-settings 与配置器脚本均使用外置协议 fixture；先在另一个终端启动 `npm run test:mock-model`，再运行相应脚本，例如 `npm run test:android:config -- <serial>`。其他原生集成脚本可能自己管理 fixture 服务，执行前检查该脚本，避免重复占用 4181。

| 脚本组                                         | 用途                                        |
| ---------------------------------------------- | ------------------------------------------- |
| android-git / git-records                      | 暂存、提交、脏文件、重启与 Git/日志回执检查 |
| android-mcp / mcp-records                      | MCP 授权、调用、unknown 与重启              |
| android-skills / skills-records / skills-fault | 包、版本、冻结授权、技能回执故障恢复        |
| android-parallel / android-runs                | 并发、排队、根任务数据恢复                  |
| android-delegation / android-proposals         | 子任务隔离、候选合入与故障恢复              |

records/native-journal/native-runs 等脚本主要是取证或辅助，不都是独立“一键验收”入口；参数语义阅读源码。模拟服务 mock-model、mock-mcp、mock-skills、mock-workspace-live 默认都监听 loopback 4181，同一时刻选需要的一种。

故障注入后的结果要核对文件、index、HEAD、operation phase、Run/Trace state 与 remote attempt，不能只观察 UI 出现“完成”。已有 trigger 注入脚本会负责特定 fixture 清理，但异常中断后仍需检查测试实例残留。

## 6. 真实服务测试

[Live 配置](../playwright.live.config.ts) 使用 tests/live、单 worker、360 秒、390×844 视口。明确在本地进程环境配置 DEEPSEEK_API_KEY 后运行：

```sh
npm run build:web
npm run test:live
```

Android 对应 `npm run test:android:live -- <serial>`。这些步骤会实际调用供应商、产生费用，并把合成资料发送到该服务。普通 check/E2E 无需真实 Key；没有凭证时 live 用例会跳过，不能把 skipped 统计成通过。

不在命令示例、日志、截图、报告或文档中写 Key。当前没有同等 Anthropic/Gemini 真服务常规回归脚本/凭证证据，它们的模拟通过不能写成真服务已验收。

## 7. 故障定位

| 现象                 | 优先核对                                                   | 当前处理                                   |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| Web “资料消失”       | origin、浏览器 profile、隐私模式、是否重建/清理站点        | 用原 origin 重开；不要先删除数据库         |
| Web 重开缺少 Key     | 页面内存 CredentialStore                                   | 重新填写凭证，业务配置仍在                 |
| 格式不匹配           | CURRENT_DATA_FORMAT、application_format/format、旧页面连接 | 明确重建本应用开发实例；保留需导出的资料   |
| VERSION_CONFLICT     | 文件 revision、HEAD/index/working 指纹、旧预览             | 刷新并查看差异，不自动替换 revision 重试写 |
| 项目无法写入         | 根任务 owner、pending operation、recoveryIssues            | 等待/取消后核对；恢复不一致保留现场        |
| recovery_required    | Run/trace/预算回执是否落库、存储容量                       | 停止新任务，重开恢复，核对最终资料         |
| MCP unknown          | dispatched/unknown attempt、远端日志/目标对象              | 人工核对后解除屏障，再决定是否新调用       |
| 模型响应无可用结果   | 协议、结束标记、maxOutputTokens、SSE/CORS、模型能力        | 看诊断结果；不能将 length 或截断当成功     |
| 模拟器脚本找不到按钮 | 开发菜单、Modal、键盘、Fast Refresh、端口、主题            | 稳定页面后重跑相关步骤，检查截图/XML       |
| 新原生依赖无法加载   | Development Build 是否重建、Metro入口                      | expo-doctor + 原生重新编译                 |

UI 错误使用公开安全消息，不能通过把未知原生异常字符串全部打印到页面来排查。取证时优先使用合成数据的隔离环境。

## 8. 恢复取证与数据安全

先记录复现步骤、平台/build、代码 SHA、format/instanceId、受影响项目/run/operation/attempt 身份以及实际状态。必要时对隔离测试文件与业务库留存副本，注意 SQLite WAL 一致性和凭证排除，不把正在写入的单个 .sqlite 文件当成可靠完整备份。

DATA_FORMAT 重建只是开发格式替换入口，不是 STORAGE/Git 对象损坏的通用修复。不要手工改 operation recorded、run completed 或清 unknown 来制造成功状态；应分析实际效果与回执，复现后修正恢复逻辑。

work 产物不提交。日志、消息帧、图片和配置端点可能有私有资料；脱敏后再分享取证结果。没有整库加密/完整备份产品保证，SecureStore 只覆盖 secret 存储。

## 9. 性能测量口径

[architecture-measurement](../scripts/architecture-measurement.mjs) 在临时 Chrome contexts 中使用实际 workspace/Git/IDB/run 模块，样本为 ordinary/history/large。记录逻辑边界读写 bytes、延迟与采样 JS heap，冷启动为新页面/JS/bootstrap，不清 OS/IDB磁盘缓存。

[android-measurement](../scripts/android-measurement.mjs) 有限定 serial 的破坏性测试实例保护，会重建其测试资料。不要把 `emulator-5572` 这个字符串当作安全证明：必须核对实际连接的是专用可丢弃模拟器和源码中的目标目录。wall time 包含 ADB/UI观察，内存为 dumpsys PSS/native heap采样峰值，Development Build x86_64 结果不等于 release arm64。

同一比较必须固定代码、build、设备、样本、重复次数和计量边界；不能将不同版本/口径的结果直接计算优化比例。大文本写日志、全树快照、Base64转换、Git对象校验和原生桥往返仍可能昂贵，当前不能据历史采样宣称发布性能达标。

## 10. 验收记录维护

稳定文档记录可复现方法和长期约束；一次测试的命令、时间、commit、平台、passed/skipped/failure 和产物另留当次记录。历史记录位于 Design，不覆盖为新的“全部通过”。

本套文档整理未改变运行源码、依赖或 Expo 配置；最终回复只报告本次实际执行的检查。后续修改本文件或其他技术文档时更新开头历史，并按 [文档维护规范](README.md) 检查相对链接和事实状态。
