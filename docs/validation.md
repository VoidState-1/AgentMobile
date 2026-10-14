# 验证记录

最近更新：2026-10-14。下方保留各阶段结果，最新 Git 工作流验证见末尾章节。

## 环境和基线

- Windows / PowerShell。
- Node.js 24.11.0，npm 11.6.1。
- Expo 57.0.28，React Native 0.86.3，React 19.2.3。
- TypeScript 6.0.3。
- JDK 使用当前 JAVA_HOME 指向的 Temurin 17。
- 仓库开发分支为 main；未配置远程仓库。

## 已通过

| 检查 | 结果 |
| --- | --- |
| npm run check | TypeScript strict 和 ESLint 通过 |
| npx expo install --check | 依赖符合 SDK 57 要求 |
| npx expo-doctor | 21/21 检查通过 |
| npx expo export --platform all --output-dir work/export | Android、iOS、Web JavaScript 打包及 Web 静态渲染通过 |
| npx expo prebuild --platform all --no-install | 当前 Windows 环境生成 Android 原生工程成功 |
| Git diff 空白检查 | 通过 |

JavaScript 打包不验证 APK、iOS 原生编译、设备权限或原生持久化能力。

Android 原生构建 :app:assembleDebug -PreactNativeArchitectures=x86_64 已尝试。Gradle 成功下载并启动 9.3.1，随后在 expo-dev-launcher-gradle-plugin 解析 org.jetbrains.kotlin.jvm:2.1.20 时失败，Gradle Plugin Portal 没有返回该插件。失败发生在应用源码编译前，当前记录为环境/依赖下载阻塞；在可访问的 Gradle Plugin Portal 或已有缓存的开发机上需要重新运行。

## 依赖审计

当前 npm audit 报告 30 项包级告警：18 high、12 moderate、0 critical。该数值包含同一根因沿依赖链传播的条目，不等于 30 个独立漏洞。

根依赖链涉及 braces、node-forge、decode-uri-component、uuid 等。示例：

- braces 深层模式导致栈耗尽：[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。
- node-forge 签名验证问题：[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)。
- decode-uri-component 异常编码导致资源耗尽：[GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)。
- uuid 特定缓冲区使用下的边界检查问题：[GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)。

审计建议中包含降级 Expo 至 44、跨 SDK 升级 Router、降级 React Native 等不适用于当前工程的选项，未执行 npm audit fix --force。初始化时 braces/node-forge 的公开 latest 也仍处于报告范围；其他跨版本替换需要逐项验证。

这不是“已通过安全审计”的结论。后续实现需要区分构建工具与进入应用运行时的依赖，验证攻击面，跟踪兼容修复，并在发布前重新审计。

## 尚未验证

- iOS 原生工程与编译：需要 macOS/Xcode 或云构建。
- 手机启动、触摸交互、后台与杀进程行为：需要模拟器和真机验证。
- 文件/Git/SQLite 一致性、libgit2 桥接和 Agent 工具执行：尚未实现。
- npm ci 的独立干净安装：锁文件已生成，后续构建环境需验证。

生成的 android/ 与 work/ 目录已按忽略规则排除；android/ 是可重建的 Expo Prebuild 输出，work/ 只存放本次检查产物。

上述“尚未验证”反映初始化阶段；当前原型已实现存储和模型协议，以下记录新的证据。

## 2026-10-13 原型验证

| 检查 | 结果 |
| --- | --- |
| TypeScript strict、ESLint、Vitest | 通过；24 个测试 |
| Pi 工具循环 | 真实 Agent Core 驱动读取、写入、取消 |
| 标准 Git 互通 | Git CLI 成功读取 isomorphic-git 创建的提交 |
| 崩溃恢复 | 文件批次中断、Git 成功但元数据写入失败，恢复后不重复提交；不明部分写入保留数据并禁止继续写入 |
| 访问限制 | 路径越界、保留路径、版本冲突、写锁、伪装图片与过大图片拒绝 |
| SSE | 任意分片、响应不完整不执行工具、图片输入开关与凭证边界 |
| 浏览器端到端 | 3 个流程通过：编辑/任务/撤销/刷新，390px 手机宽度，图片导入/兼容服务工具调用 |
| Expo Doctor | 21/21 检查通过 |
| Expo SDK 版本检查 | 依赖符合 SDK 57 |
| Android/iOS/Web JavaScript 打包 | Pi 移动入口与 Git 浏览器构建打包通过 |
| Android 原生 APK | Gradle assembleDebug x86_64 编译成功；安装到 API 36.1 模拟器 |
| Android 操作流程 | 创建工作区、运行 Pi 工具、生成 summary.md、强制停止后重新打开，文件仍存在 |

Pi 原始默认根入口在 Metro 报出动态 import 无法静态解析，已通过公共纯工具函数的移动入口解决。Agent Core 未 fork，模型传输单独注入。

Web 最初 static 输出出现 React Suspense hydration #419；本地数据应用改为 single 输出后端到端流程通过且未捕获页面异常。

浏览器协议测试使用模拟 SSE 服务和测试密钥，不代表已验证某家实际付费模型服务。桌面宽度与 390px 宽度截图分别保存在 work/prototype-desktop.png、work/prototype-mobile.png。

Android Kotlin 插件阻塞已解除，安装 NDK 27.1/27.0 和 Build Tools 36 后构建成功。实际运行验证使用 x86_64、API 36.1 模拟器与 Metro Development Build；截图在 work/prototype-android.png。Pi 工具循环、SQLite 元数据、Expo 文件读写和 Git 提交在该原生环境中运行成功。

最初 Metro --localhost 在 Windows 绑定 ::1，ADB reverse 的 IPv4 连接失败；测试改为 LAN 绑定并设置 REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 后连接成功。这是本地开发连接问题。

Android arm64 真机、原生掉电/空间不足测试、SecureStore 写入验证和 iOS 原生编译仍未完成。原型 Git 后端为 isomorphic-git；libgit2 原生桥接未实现。

新增依赖后 npm audit 仍为 30 项（18 high、12 moderate），0 critical；没有使用破坏 Expo 兼容性的强制修复。

## 2026-10-13 前端重做

设计基线：深浅两色、简约现代、紧凑工具界面。会话、资料、版本有独立操作区，移动端输入区固定，编辑器使用全屏或桌面侧栏。

已验证的浏览器流程（6 项）：

1. 编辑 → Pi 任务 → 逐行变化 → 恢复 → 刷新后读取。
2. 未保存保护、保存后离开、文件搜索。
3. 深浅切换、跟随系统变化、主题偏好持久化、项目输入草稿保留。
4. 360px 手机和 500px 短视口：固定输入区可操作、无横向溢出、全屏编辑。
5. 图片导入、兼容服务工具调用、文件结果读取。
6. Shift+Enter 换行、Enter 发送、Ctrl+S 保存、新建/重命名/删除。

检查发现并修复了嵌套 Modal 确认按钮被预览层挡住、快捷保存事件被 TextInput 拦截的问题；没有用强制点击绕过。

领域/协议测试增至 25 项，包含连续任务保留上一轮目标与回复。TypeScript 和 ESLint 通过。Expo Doctor 21/21 通过。

截图经视觉检查：work/workbench-mobile-light.png、work/workbench-mobile-dark.png、work/workbench-desktop-editor-light.png。

Lucide 图标按公开单图标子路径导入，Web bundle 约 2.3 MB，避免把整个图标目录打入应用。

Android 新开发客户端已编译成功，新增 react-native-svg 和开发菜单配置。API 36.1、x86_64 模拟器实际操作通过：

- 软键盘保持展开时输入项目名称并创建工作区。
- 打开文字资料、全屏编辑、离开触发未保存提示、继续编辑保留草稿、保存后离开。
- 输入任务并发送，Pi 读取资料、写入 summary.md，Git 保存版本。
- 强制停止应用后重开，自动恢复项目选择；整理文件与手动编辑的内容仍存在。
- 原生浅色/深色切换及重启后外观偏好保留；截图经视觉检查：work/workbench-android-light.png、work/workbench-android-dark.png。

原生验证发现 Android 软键盘遮挡底部面板的创建按钮，已为面板和全屏编辑器增加键盘避让，并在键盘展开时重新操作通过。新建面板截图在 work/workbench-android-keyboard.png。

实时主题切换后原生导航层曾保留浅色状态栏，已统一导航主题、页面主题与状态栏选项。深色状态栏以及键盘展开时的编辑界面也经截图检查；编辑截图在 work/workbench-android-editor.png。

最终 npm run check 通过（25 项测试），6 项浏览器流程全部通过；Android/iOS/Web JavaScript 导出成功。iOS JavaScript 打包不代表 iOS 原生编译通过，arm64 真机和真实付费模型服务仍未验证。

## 2026-10-13 DeepSeek 真实服务验证

本节更新前面“真实供应商”和“Android SecureStore 尚未验证”的状态。使用临时授权密钥、合成文字与测试图片连接 DeepSeek 官方 https://api.deepseek.com，模型为 deepseek-flash。

| 检查 | 结果 |
| --- | --- |
| 身份与模型列表 | /models 返回 HTTP 200，包含确切模型 deepseek-flash |
| 文本工具闭环 | 从 notes.md 整理到 plan.md，读取保存内容核对时间、预算、饮食和联系人 |
| 连续对话与修改 | 追问把预算从 300 改为 250，原笔记逐字保持不变 |
| Git 差异与恢复 | 预览本轮行程变化，撤销后与修改前全文完全一致 |
| 真实图片理解 | 提示中未提供图片答案；inspect_image 读取合成图片后保存 B-17、14:30 和 6 人，原图保留 |
| 页面重开 | 重开后图片提取文档内容完全一致 |
| Android 原生真实调用 | API 36.1 x86_64 的原生 SSE、读取文字、保存文档和 Git 修改通过 |
| Android 凭证与重启 | SecureStore 保存密钥后强制停止重开，不重新输入密钥，追问生成的新文档保留源资料识别码 |
| 原生可重跑脚本 | npm run test:android:live -- emulator-5556 完整通过 |
| 最终真实浏览器回归 | npm run test:live 通过；本轮 9 次模型请求全部 HTTP 200，协议记录合计 11,524 tokens |
| 常规回归 | npm run check 通过，31 项测试；6 项浏览器流程通过 |
| 三平台 JavaScript 导出 | Android、iOS、Web 导出成功 |

修复与补充：

- DeepSeek 预设填写官方地址、模型及图片输入；增加不生成内容的 /models 连接检测。
- 将 Pi 的 off 明确传给 DeepSeek thinking.type=disabled。思考模式的上下文传递仍未实现。
- SSE 读取到 DONE/EOF，保留完成帧后的用量；只有 DONE、异常完成标记或不完整工具调用不判为成功。
- 服务错误按 HTTP 状态展示可采取操作的提示；不把原始错误响应或密钥写入任务。
- 每个模型生成轮次刷新当前回复，最终只显示最终答案；完整中间轮次保留在 transcript。
- 新任务与重新打开会话时滚动到最新消息。

原生自动化中定位到 React Native 调试包的快捷键干扰：Modal 内 ADB 硬件输入连续 R，会被 Activity 的“RR”识别器当作重载，导致编辑页面退出。已在测试文字中避开这个调试快捷键；ReactDelegate 对 release 模式不启用该重载逻辑。屏外旧会话不会出现在原生无障碍树中，因此原生测试以实际生成的文件和内容为验收依据。

最终截图经视觉核对：work/deepseek-live-conversation.png、work/deepseek-android-result.png、work/deepseek-android-followup.png、work/deepseek-android-conversation.png。

真实服务测试仅在显式提供 DEEPSEEK_API_KEY 时运行，浏览器套件另有限制最多 20 次模型请求；普通 check/e2e 不调用付费服务。协议报告、截图、临时凭证及账户数据仅放在忽略目录，凭证在验证结束后清理。费用以供应商账单为准；单轮回归的余额可能尚未变化，金额精度和结算时延均可能影响显示，不能据此宣称免费调用。

参考：[DeepSeek 模型与价格](https://api-docs.deepseek.com/quick_start/pricing)、[思考与工具调用](https://api-docs.deepseek.com/guides/thinking_mode)、[图片输入](https://api-docs.deepseek.com/guides/vision)。其他兼容供应商、iOS 原生、arm64 真机、异常掉电和空间不足场景仍需单独验证。

## 2026-10-13 多供应商配置器

本轮按用户确认完成实现与模拟验证，不需要 Anthropic/Gemini 官方凭证。普通测试完全不调用付费服务。

| 验证 | 结果 |
| --- | --- |
| npm run check | TypeScript、ESLint 通过，60 项测试通过 |
| 配置存储和迁移 | 两连接同名模型密钥隔离、失败注入、旧凭证延迟清理、幂等迁移、Origin 绑定、目录合并、删除明确选择后阻止隐式回退通过 |
| 三协议 Pi 闭环 | Chat Completions、Anthropic Messages、Gemini 分别执行真实工作区工具写入与 Git 提交，通过 |
| 协议细节 | 任意字节分片、多个工具调用、截断/输出上限、流内错误、取消、认证、图片格式与授权、原生签名和调用关联通过 |
| 目录与检测 | 分页、生成模型筛选、能力来源、内置文本/工具/图片样本核对通过 |
| 运行配置固定 | 界面取消订阅后任务继续；运行中替换密钥和参数，后续轮次仍使用原配置；新任务采用新配置，通过 |
| 浏览器流程 | 11 项通过；包含三协议生成/工具/图片检测和文件结果、密钥隔离、收藏筛选、复制无凭证、未保存保护、刷新缺失凭证时保留草稿 |
| 浏览器视觉 | 390px 深浅配置页经截图检查，无横向溢出；原工作台编辑、恢复、键盘快捷操作回归通过 |
| Android 工作台回归 | API 36.1 x86_64，编辑、未保存保护、Pi/Git 修改、强制停止重开、主题持久化通过 |
| Android 配置器 | API 36.1 x86_64：三协议目录、工具/图片检测、Pi 文件写入和 Git 历史通过；重启后 SecureStore 凭证可读、未保存保护和深浅主题通过 |
| Android/iOS/Web 导出 | 三平台 JavaScript/Hermes 打包通过；不等同于 iOS 原生编译和真机验收 |
| Anthropic/Gemini 官方实测 | 待提供测试凭证；本轮未调用官方服务 |

浏览器截图：work/config-mobile-light.png、work/config-mobile-dark.png。配置器测试源码在 tests/model-config.test.ts、tests/provider-protocols.test.ts、tests/task-manager.test.ts、tests/e2e/model-config.spec.ts。

原生截图：work/config-android-light.png、work/config-android-dark.png，以及三个协议各自的 form/result 截图，均经视觉核对。模拟服务为 scripts/mock-model-server.mjs；操作脚本为 scripts/android-model-config.mjs。运行期间使用独立 emulator-5556，已有设备不做改动。三协议与重启检查分别重跑通过；调试自动化曾因同名认证选项、输入框被固定页脚遮挡和末行边界判断过严失败，已修正定位与滚动条件。

生成诊断每项最多 2 次模型生成、128 输出 tokens、30 秒；目录最多 20 页/5,000 条，不自动发起付费测试。服务错误正文与认证头不进入公开记录；检测失败不会被误记为能力不支持，后续编辑参数保留已验证能力依据。Gemini 无原生 ID 的调用按请求轮次分配宿主 ID，避免相同时间戳下的重试日志冲突。价格资料尚未实现，Pi 用量 cost 占位不作为费用估算。

本轮还修正原生配置页的软键盘避让；原生 UI 自动化按字段类型定位 API Key，避免把认证选项的同名文本当成输入框。调试包的硬件 R 重载干扰仍通过测试样本规避，正式包不使用该调试逻辑。

保留限制：iOS 原生、arm64 真机、真实供应商网络/账号差异、后台限制、空间不足和异常掉电仍需验证；模拟服务只能证明客户端协议和宿主执行链路。

## 项目下的多对话验证

本轮将对话从项目中拆为独立实体；项目文件和 Git 历史继续共享。每个任务冻结 conversationId，聊天上下文、草稿、附件引用和明确模型/模式选择按对话隔离。

| 验证 | 结果 |
| --- | --- |
| npm run check | TypeScript、ESLint、65 项测试通过 |
| 迁移与失败恢复 | 旧任务迁移中断后重试、固定 main ID 保留模型 pin、保存失败保留原草稿、已提交草稿清理失败后恢复、后来编辑的新版本不被清除，通过 |
| 对话生命周期 | 归档与恢复保留内容，最后一个对话归档后创建空对话，重启不复活归档历史，运行租约阻止归档，通过 |
| 实际 Pi 上下文 | A → B → A 的模型请求只携带各自历史、分别选择模型/模式，任务记录包含对话和草稿版本，通过 |
| 浏览器 | 14 条完整流程通过；新增独立草稿/附件、刷新选择、归档恢复、旧消息迁移、运行中切换对话与请求历史隔离 |
| Android | API 36.1 x86_64：A/B 两对话独立消息、草稿及附件，发送任务、强制停止后恢复、归档恢复、深色与再次重开通过 |
| 三平台导出 | Android、iOS、Web JavaScript/Hermes 打包通过；iOS 原生与真机待验证 |

原生验证脚本：`node scripts/android-conversations.mjs <serial>`，需要开发客户端、Metro 和对应 adb reverse。使用演示传输，不调用付费服务。本轮仍使用独立 emulator-5556。

截图经视觉检查：work/conversations-mobile-light.png、work/conversations-mobile-dark.png、work/conversations-desktop.png、work/conversations-android-restored-draft.png、work/conversations-android-dark.png。

完整回归发现并修复项目创建结束前点击切换被忽略的问题：操作期间明确禁用项目切换。原生自动化等待开发菜单的首次提示，并区分输入草稿和添加引用后包含多行参考说明的任务消息。

边界：草稿只保证最后成功写入的版本；切换不取消任务，但仍仅运行一个任务。对话永久删除、多任务并发、分叉、跨项目移动尚未实现。

## 2026-10-14：有序工作轨迹与公开推理

| 验证 | 结果 |
| --- | --- |
| npm run check | TypeScript、ESLint、74 项测试通过 |
| 三协议真实 Pi 模拟循环 | 推理 → 过程文字 → 两个同名工具 → 最后一轮答案，顺序正确；toolCallId 独立配对；增量可见且最终快照持久化 |
| 协议回传 | DeepSeek reasoning_content、Anthropic thinking/signature/redacted_thinking、Gemini 原生 parts/thoughtSignature 在工具后续轮保留；轨迹不包含不透明签名与测试密钥 |
| 内容顺序 | Gemini 的文字/摘要多次交错不合并到首个文本块；Anthropic 非空初始文字块也进入轨迹 |
| 推理参数 | off/default/on 冻结为任务快照；DeepSeek 开关、Anthropic 预算/自适应、Gemini 预算/等级映射正确；无效预算、不支持能力、Anthropic 温度约束在发送前拒绝 |
| 取消与检查点 | 慢速存储下取消保留部分推理，任务写入串行，最终 cancelled 不被旧快照覆盖；恢复仅收束仍运行的节点 |
| 浏览器 | 全量 18 条流程通过；三协议推理配置生效、工具详情、收起轨迹保留最后回复、刷新保留轨迹；中断恢复和旧任务兼容通过 |
| 布局 | 390px 深浅主题截图检查通过；360×500 输入区可见、无页面横向溢出 |
| Android 原生 | API 36.1 x86_64、独立 emulator-5556：Gemini 原生推理流、文字/工具顺序、工具输入/结果、SQLite 重启保留、深浅主题通过；生成摘要期间强制停止后恢复为 interrupted，已收到内容保留 |
| 三平台导出 | Android、iOS、Web JS/Hermes 导出通过；iOS 原生与 arm64 真机待验证 |

本轮不调用付费服务。Anthropic/Gemini 的官方服务验证仍待凭证，DeepSeek 新增开启推理路径也仅模拟验证；前版 DeepSeek 非推理路径的官方实测不能替代这些验证。通用 Chat Completions 推理开关方言和 Responses 尚未实现，不自动猜测模型开源属性或隐藏推理。

原生复现：启动 Metro，并用 `AGENT_MOBILE_MOCK_TRACE=1 node scripts/mock-model-server.mjs` 开启本机流式 fixture；设置 ANDROID_HOME、AGENT_MOBILE_METRO_PORT 与 adb reverse 后运行 `node scripts/android-trace.mjs <serial>`。脚本使用测试凭证、生成数据和真实本地 Git/SQLite，不访问供应商。生成中断采用确定性暂停流。

截图：work/trace-mobile-{协议}-light.png、work/trace-mobile-{协议}-dark.png、work/trace-android-light.png、work/trace-android-tool-details.png、work/trace-android-dark.png、work/trace-android-interrupted.png。截图与导出均为忽略的本地验证产物。

持久化边界：每约 200ms 合并检查点，消息/工具边界与终态立即入队；强制停止可能丢失最后尚未提交的增量，不承诺逐 token 落盘或自动续跑。

## 2026-10-14：长任务预算与系统提示词设置

默认模型请求 10 → 50 轮，工具调用 30 → 200 次，任务总时长 2 → 20 分钟，单次生成请求超时 60 → 300 秒。全局系统提示词与这四项预算、历史数量可从“设置 → Agent 设置”修改，分别恢复提示词/预算，并保存到 settings/agent。任务记录增加 agentSettingsSnapshot，固定启动时配置。

| 验证 | 结果 |
| --- | --- |
| npm run check | TypeScript、ESLint、85 项测试通过 |
| 长 Pi 任务 | 实际执行 35 次 list_files、36 轮模型请求，越过旧轮数/次数限制并完成；自定义低轮数/次数仍正确停止并指出对应上限 |
| 请求与任务超时 | 使用可控时钟验证 75 秒流式请求可完成，显式 10 秒请求超时仍停止；任务总时长到期标为 failed 并保留部分推理，主动取消的原回归通过 |
| 系统提示词与配置版本 | 设置保存/重开恢复、冻结快照、保存失败保持旧值、并发旧 revision 拒绝；运行中修改后，当前任务两轮请求仍用原提示词，下一任务采用新提示词和预算 |
| 大文字资料 | 200,000 字符/600 KB UTF-8 文本通过真实工具写入与 Git 提交；超过旧 512 KB 的 SSE 响应正常解析；分页读取返回准确 offset/nextOffset/totalCharacters 与完整文件修订号；超过 1 MB 仍拒绝 |
| 草稿、历史、模型上限 | 16,000 字符草稿保存通过，16,001 拒绝；携带 8 条历史，设为 0 后不携带；32,768 输出可配置，供应商公布更低值仍拒绝 |
| 浏览器 | 21 条流程通过（首轮 20 条通过，旧默认输出断言更新后剩余 1 条定向重跑通过）；新增 Agent 设置保存、刷新、错误校验、未保存保护、深浅/短视口、运行快照和 6 MB 图片导入/刷新持久化 |
| Android | API 36.1 x86_64，独立 emulator-5556：系统提示词及 80 轮/300 工具/30 分钟/600 秒保存、强制停止重开恢复，未保存保护、演示任务、深浅主题、独立恢复默认预算并再次重开，通过 |
| 三平台导出 | Android、iOS、Web JS/Hermes 打包通过；iOS 原生与 arm64 真机待验证 |

网络与内容限制同时提高：请求体 8 MB、SSE 响应 4 MB、单轮 32 工具、单次文字工具 240,000 字符、文本文件 1 MB、系统导入与浏览器导入 20 MB、模型图片 4 MB；像素上限仍为 2,400 万。新模型默认输出 8,192、可配置至 65,536，目录公布更低上限时继续约束；已有模型参数不迁移覆盖。

原生复现：设置 ANDROID_HOME、AGENT_MOBILE_METRO_PORT，启动开发客户端和 Metro、配置 adb reverse，再运行 `node scripts/android-agent-settings.mjs <serial>`。本轮使用本地模拟协议与演示，不消耗真实供应商额度。

视觉检查：work/agent-settings-mobile-light.png、work/agent-settings-mobile-dark.png、work/agent-settings-android-light.png、work/agent-settings-android-dark.png。390px 深浅主题和 360×500 视口均可用；原生保存按钮固定，软键盘与表单滚动正常。

边界：供应商的上下文、输出、图片和限流约束仍适用；历史以字符量保守预留空间，精确 tokenizer、当前任务自动摘要压缩、后台常驻和自动续跑尚未实现。提示词编辑只改变模型行为描述，受控路径、版本校验和宿主工具权限继续执行。

## 2026-10-14：Agent 执行期间的资料实时刷新

修复原先只有任务结束才刷新资料的问题。工作台订阅 WorkspaceService 的已完成文件操作；每次 Git/操作日志记录成功后更新列表、版本和打开文档。读取快照与文件写入使用同一项目队列，连续通知在一次读期间合并，刷新不跟随每个模型 token。

| 验证 | 结果 |
| --- | --- |
| npm run check | TypeScript、ESLint、88 项测试通过 |
| 变更事件 | 创建/保存即时通知，已 recorded 的重试不重复通知；观察者抛错不破坏已提交写入；记录失败不发成功通知，恢复补记后才发布 |
| 读取与修改交错 | 在移动“已移除旧路径、尚未写入新路径”处暂停写入；只读快照等待操作完成，返回的文件/预览/Git/操作日志一致，通过 |
| 浏览器完整回归 | 24 条全量流程通过；补充启动导航测试定向通过，实时相关 4 个场景均验证通过，合计 25 条覆盖 |
| 执行中的资料 | 模拟供应商保留最终响应未结束：第一版文件可见、打开文档更新第二版、版本数更新、移动及删除反映到列表，原路径预览关闭；此时“停止任务”仍可见 |
| 项目和草稿 | 后台项目写入期间，另一个项目的未保存正文保留且无串入文件；切回执行项目可读新资料 |
| Markdown 图片 | 文本本身未变时，引用图片删除会失效重载，旧图片消失并显示不可用；任务继续运行 |
| 启动导航 | 发送后立即切到资料，启动完成与任务完成均不强制切回会话，通过 |
| Android | API 36.1 x86_64、独立 emulator-5556：任务最终回答被 fixture 暂停时，新建文件已出现在资料；打开预览从第一版更新第二版；随后完成任务，强制停止重开仍保留第二版，通过 |
| 三平台导出 | Android、iOS、Web JS/Hermes 打包通过；iOS 原生与 arm64 真机待验证 |

原生验证：启动 `node scripts/mock-workspace-live.mjs`，配置 Metro/ANDROID_HOME/AGENT_MOBILE_METRO_PORT 与 adb reverse，运行 `node scripts/android-workspace-live.mjs <serial>`。本机 fixture 提供两个写入和手工释放后续响应的门控，不调用付费服务。若测试过程已进入等待后续响应阶段，--resume 只继续资料验证，不能用于重开已停止的 Agent。

截图经视觉检查：work/workspace-live-reading.png、work/workspace-live-android-reading.png，均能看到 Agent 仍运行而预览已显示第二版。

原生检查同时发现并修复异步启动结束时导航覆盖用户选择的时序问题：会话标签选择提前到任务启动前，之后保持用户选中的资料/版本页面。自动化等待连接保存后的路由重建完成；多轮写入 fixture 使用独立工具调用 ID。

边界：刷新展示已成功写入的版本，不展示文件操作应用中的中间状态；有未保存正文或名称时保留草稿并标记新版本，不静默覆盖。应用外部文件监视、多页面协作尚未实现。

## 2026-10-14：远程 MCP

手机作为客户端连接 Streamable HTTP 服务器，官方客户端锁定 2.3.1。实现范围见 [remote-mcp.md](remote-mcp.md)，入口为“设置 → 远程 MCP”。本轮使用本地可控 MCP/模型服务，不访问付费供应商。

| 验证 | 结果 |
| --- | --- |
| npm run check | TypeScript、ESLint、104 项测试通过；新增 16 项 MCP 验证 |
| 官方 SDK | 2026-07-28 server/discover/逐请求元数据，以及 2025-11-25 initialize/session 回退；JSON/SSE、分页和进度通过 |
| 项目授权 | 默认关闭、项目隔离、目录变更撤销授权、未授权工具不进入模型请求；实际 Pi 远端查询 → 本地 write_text → Git 提交通过 |
| 配置/凭证 | 冻结工具/参数/Token 租约，替换或删除后旧 Token 等租约释放再清理；保存失败与初始化清理恢复通过；参数预览、返回结果、定义与任务快照无测试 Token |
| 失败与恢复 | 参数/定义校验在发送前拒绝；发送日志失败不联网；HTTP 认证拒绝与未知执行区分；取消/超时/超大回执/保存回执失败均保留未知状态，同参数不自动重发；prepared/dispatched 重启收束通过 |
| 浏览器完整回归 | 29 条全量流程通过；包含两代 MCP、配置/授权、工作轨迹、刷新缺失 Token、深浅主题、未保存保护、未知记录与删除连接后核对 |
| Android 原生 | API 36.1 x86_64、独立 emulator-5556：两代 SSE MCP 真网络调用、Token 重开保留、Agent/Git 文件、进度、发送后强制停止恢复为 interrupted/unknown、显式解除重试限制通过 |
| 原生持久化证据 | 直接读取隔离模拟器 SQLite：两代调用均有 completed 回执、匹配 completed 工具轨迹及不同 base/final Git commit；暂停调用保留 unknown 回执和 interrupted 任务，核对时间已记录；任务/回执无 Token |
| 三平台导出 | Web、Android/iOS JS/Hermes 导出通过；Expo Doctor 21/21 通过；iOS 原生、arm64 真机与真实外部 MCP 服务待验证 |

完整浏览器回归发现并修复内置工具标签变化和删除连接后编辑页卸载导致导航未完成的问题。原生自动化最初误点被页脚遮住的授权开关，已改为定位可交互控件并检查完整可见范围及 checked 状态；同时通过模拟服务器调用计数和原生 SQLite 回执确认真正执行，不能只依赖模拟模型的完成回复。

原生复现：`node scripts/mock-mcp-server.mjs` 启动本机 4181 fixture；配置 ANDROID_HOME/AGENT_MOBILE_METRO_PORT、开发客户端和 adb reverse，运行 `node scripts/android-mcp.mjs <serial>`。SDK schema 校验器会标注输入定义，因此编译前复制 schema，保持任务快照不可变；Metro 为 SDK 和 PKCE 使用浏览器入口，避免 Node 默认分支。

截图经视觉检查：work/mcp-mobile-light.png、work/mcp-mobile-dark.png、work/mcp-android-tool.png、work/mcp-android-restored.png、work/mcp-android-unknown.png。布局延续紧凑工具界面，配置固定保存区，远端步骤按时间显示。

边界：首版只支持无需认证/Bearer Token 与完整 HTTPS 端点（loopback 可 HTTP），尚无 OAuth、自定义 Header、旧 SSE 双端点、stdio、Resources/Prompts 浏览、Tasks、MCP Apps、sampling/roots/elicitation 或后台常驻。未知状态采用保守语义，远端 exactly-once、幂等键和业务撤销未实现。删除/重建连接不会绕过同端点/工具/参数的未知记录。

## 2026-10-14：Agent Skills

接入通用 SKILL.md、Markdown/ZIP 导入和独立 Git 技能库。用户从“设置 → Agent Skills”管理内容与项目启用，输入区提供“选择技能”。实现和兼容范围见 [agent-skills.md](agent-skills.md)。本轮使用本地模拟模型，不调用付费服务。

| 验证 | 结果 |
| --- | --- |
| npm run check | TypeScript、ESLint、118 项测试通过；新增 14 项技能验证 |
| 格式与导入 | YAML 块标量、BOM/CRLF、可选元数据、多技能 ZIP、目录规范化、导出再导入通过；重复字段、错误类型、别名、越界、重复大小写路径、嵌套技能与超限拒绝 |
| 解压边界 | 不仅校验声明大小；伪造 ZIP 大小字段后，实际输出超过限制仍被流式检查拒绝，通过 |
| Git/SQLite 与恢复 | 多文件写入中断后日志恢复；Git 已提交但技能配置未保存时重新扫描；更新撤销旧启用、历史恢复新提交、内部库不进项目列表通过 |
| 版本固定 | 任务捕获旧 Git commit 后，编辑或删除技能仍可读取旧正文与资源；引用文件变化也改变技能版本，旧页面/预览提交被拒绝 |
| 三协议真实 Pi 模拟循环 | Chat Completions、Anthropic Messages、Gemini：首轮仅目录 → load_skill 正文 → read_skill_resource 引用 → write_text/Git 保存；未启用技能正文不进入模型请求，通过 |
| 明确调用与上下文 | $技能名 由宿主首轮注入并保存加载轨迹；重复加载去重、下一任务不携带旧技能正文、未启用调用保留草稿、普通金额不误识别，通过 |
| 浏览器 | 32 条全量回归通过；补充防护修改后的 3 条技能流程定向重跑通过；覆盖导入/编辑/引用、启用/撤销、自动与明确调用、历史/导出/删除、未保存保护、深浅/短视口、运行期间更新与删除 |
| Android | API 36.1 x86_64、独立 emulator-5556：系统文件选择器导入 ZIP、项目启用、实际 Pi 自动加载/引用/Git 文件，重启后资源编辑/重新启用、明确调用读取新资源、深色与版本历史，分段验证通过 |
| 原生持久化证据 | 隔离模拟器 SQLite 验证自动/明确激活、completed 资源轨迹和 Git 修改；资源更新前后任务技能 revision 不同，重新启用已保存；技能库没有出现在用户项目表，导入/更新操作均有 recorded 回执 |
| 打包与依赖 | Web、Android/iOS JS/Hermes 导出通过，Expo Doctor 21/21；iOS 原生与 arm64 真机仍待验证 |

原生自动化修复了两处测试干扰：Modal 输入中的重复 R 键会触发开发客户端重载，因此改用不触发快捷键的样本文本；编辑弹窗内的硬件 Back 会触发关闭/未保存保护，改为直接点击键盘上方的应用按钮。版本行包含修订号，等待改为匹配“当前版本”片段；截图等待正文加载后再捕获。原生数据库与模拟服务实际请求共同验证结果，不能只依赖完成回复。

复现：启动 `node scripts/mock-skills-server.mjs`，设置 ANDROID_HOME/AGENT_MOBILE_METRO_PORT，配置开发客户端和 adb reverse，运行 `node scripts/android-skills.mjs <serial>`。持久化核对可独立执行 `node scripts/android-skills-records.mjs <serial>`。脚本使用隔离 fixture 与生成数据。

截图：work/skills-mobile-light.png、work/skills-mobile-dark.png、work/skills-android-library.png、work/skills-android-trace.png、work/skills-android-dark.png、work/skills-android-history.png。深浅界面与原生历史截图经过视觉检查，技能加载与资源读取沿用有序轨迹。

边界：脚本只读不执行、其他二进制资源只保留供导出，allowed-tools 不增加工具权限。远程市场/自动下载、原生目录扫描、改名/分叉、已删除技能恢复、签名与容量清理尚未实现；演示模式不会理解技能语义。当前未做自动上下文压缩，未来必须保护已激活技能内容。

## 2026-10-14：传统 Git 工作流

项目文件从逐动作自动提交升级为工作区/index/HEAD 分离，实施说明见 [git-workflow.md](git-workflow.md)。本轮使用演示与模拟模型，没有调用付费供应商。

| 验证 | 结果 |
| --- | --- |
| npm run check | TypeScript strict、ESLint、130 项 Vitest 通过；新增 12 项 Git 工作流回归 |
| 标准 Git CLI | 连续保存不移动 HEAD，私有引用不进入普通 log；暂存 v1 后编辑 v2，提交与 index 仍为 v1，工作区 v2 为未暂存；选择性提交保留其他已暂存内容；重命名/删除/取消暂存与 CLI 状态一致 |
| 冲突与恢复 | 陈旧 HEAD/index/文件指纹、空提交、非法提交说明拒绝；index 批次部分写入、提交成功但数据库回执失败、内部检查点回执失败可恢复；旧无 kind 自动提交日志仍恢复，旧历史保持 |
| 任务与 Agent | 普通 Pi 任务不提交；明确 Git 工具循环生成一个提交；任务前已有脏文件可编辑，但 Agent 暂存/取消暂存/提交被拒绝；任务撤销恢复原工作区/index，保留无关文件与公开历史；后续冲突阻止撤销 |
| SQLite 查询顺序 | 打乱 ID/写入顺序后，任务恢复仍按 sequence 采用最后文件/index 检查点；纯暂存区变化也有预览、待提交提示与撤销 |
| 浏览器 | 35 条全量 Playwright 回归通过；Git 覆盖暂存后再编辑、刷新保留 index、明确提交、两类差异、取消暂存、脏工作区拒绝历史恢复、恢复不增加提交、未跟踪文件丢弃、手机深浅主题与短视口 |
| Android | API 36.1 x86_64、隔离 emulator-5556：暂存 v1 后强制停止重开、编辑 v2、预览差异并提交 v1、演示任务只生成未跟踪资料、再次重启与深浅主题通过 |
| 原生仓库与 SQLite | 导出本轮合成项目的原生仓库，用系统 Git 验证公开历史仅 2 个提交、HEAD/index 为 v1、磁盘为 v2、summary 未跟踪、检查点有独立引用；SQLite 任务快照与 recorded 文件/index/commit 回执一致 |
| 原生提交恢复 | 在停止的隔离应用数据库中把已完成 commit 回执改回 prepared 并移除 commit 字段，重新启动后补记为 recorded；再次导出仓库仍仅 2 个提交，v2/summary 保留；分段验证通过 |
| 构建 | Web、Android/iOS JavaScript/Hermes 导出通过；本轮未修改依赖/Expo 配置，沿用上一轮 Expo Doctor 21/21。iOS 原生与 arm64 真机待验证 |

复现：配置 ANDROID_HOME、AGENT_MOBILE_METRO_PORT，启动隔离开发客户端/Metro 并 adb reverse，运行 `node scripts/android-git.mjs <serial>`。仅对合成测试应用执行回执注入，勿指向用户模拟器。`node scripts/android-git-records.mjs <serial>` 在应用停止后核对；`--inject-recovery` 写回合成回执后可用 UI 脚本 `--recover` 单独核对恢复。首次启动本地 Metro 使用 LAN 监听并将发布主机设为 loopback，避免只监听 IPv6 localhost 而 adb reverse 无法连接；恢复脚本使用 run-as cp 写回 fixture 数据库，避免 adb shell 重定向引用问题。

截图经过视觉检查：work/git-mobile-light.png、work/git-mobile-dark.png、work/git-android-staged.png、work/git-android-diff.png、work/git-android-light.png、work/git-android-dark.png。原生验证数据库与仓库包保留在 work/，不提交。

尚未实现：逐块暂存、分支/合并、远程 Git、libgit2、完整仓库导入导出、检查点保留期/GC、大仓库增量优化。真实断电/fsync 与原生原子替换保证仍需专项验证；普通进程终止和模拟跨存储失败不能替代这些保证。

## 2026-10-14：架构 v2 R0

领域类型、共享界面、bootstrap 与 AppServices 已整理。AppServices 在运行时只导出明确方法，剔除 fs/metadata/git/credentials、内部租约、claim/recover、技能库原始仓库；界面操作不能传入 owner 绕过活动项目锁。工作区查询只返回操作路径摘要，不返回恢复日志的完整前后字节。旧偏好、任务/轨迹、模型/MCP/技能配置及文件布局不变。

npm run check：TypeScript、ESLint、134 项测试通过；新增 3 项真实 facade 与旧数据测试、1 项实际 ESLint 导入边界验证。35 条全量浏览器回归通过，覆盖三协议、MCP unknown、Skills 固定版本、Git、刷新与主题。Web 与 Android/iOS JS/Hermes 导出通过；未改依赖/Expo 配置。本阶段不宣称多 Agent 或原生设备新流程已验证。

首轮浏览器回归发现通用错误清理隐藏了“此连接需要填写 API Key”的有效提示，已保留该领域消息后全量重跑通过。平台原始错误仍映射为不含私有路径的 AppError。

## 2026-10-14：架构 v2 R1 与 R2 基础

R1 工作区、运行生命周期、Pi SDK、工具、协议、工作台控制器已拆分。136 项测试与 36 条浏览器回归通过；补充终态落库/写锁释放顺序、订阅异常隔离和未保存确认后导航验证。Web 与 Android/iOS JS/Hermes 导出通过。

隔离 emulator-5556：android-git 全流程通过（暂存后重启、冻结 v1 提交、v2 未暂存、演示任务待提交、SQLite 回执注入恢复、标准 Git CLI）；android-mcp 全流程通过（2025/2026、凭证/重启、进度与未知回执收束）；android-skills 全流程通过（ZIP、授权、自动/明确加载、旧版本读取与资源更新、历史、SQLite）。使用合成资料与本地 fixture，未调用付费供应商。已关闭本轮模拟器、Metro 与 fixture，保留用户 4180 预览。

R2 请求资源池新增 3 项并发/公平/取消/前后台验证；运行仓库新增 2 项迁移中断/重试、索引分页、原子委派回执/去重/范围验证。当前 npm run check 共 141 项通过。新运行仓库尚未接入真实启动流程；原生 batch 端口、调度/组预算/运行树与隔离提案不能据此宣称已验证，后续继续落实。
