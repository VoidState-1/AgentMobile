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

| 检查                                                    | 结果                                                 |
| ------------------------------------------------------- | ---------------------------------------------------- |
| npm run check                                           | TypeScript strict 和 ESLint 通过                     |
| npx expo install --check                                | 依赖符合 SDK 57 要求                                 |
| npx expo-doctor                                         | 21/21 检查通过                                       |
| npx expo export --platform all --output-dir work/export | Android、iOS、Web JavaScript 打包及 Web 静态渲染通过 |
| npx expo prebuild --platform all --no-install           | 当前 Windows 环境生成 Android 原生工程成功           |
| Git diff 空白检查                                       | 通过                                                 |

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

| 检查                              | 结果                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| TypeScript strict、ESLint、Vitest | 通过；24 个测试                                                                              |
| Pi 工具循环                       | 真实 Agent Core 驱动读取、写入、取消                                                         |
| 标准 Git 互通                     | Git CLI 成功读取 isomorphic-git 创建的提交                                                   |
| 崩溃恢复                          | 文件批次中断、Git 成功但元数据写入失败，恢复后不重复提交；不明部分写入保留数据并禁止继续写入 |
| 访问限制                          | 路径越界、保留路径、版本冲突、写锁、伪装图片与过大图片拒绝                                   |
| SSE                               | 任意分片、响应不完整不执行工具、图片输入开关与凭证边界                                       |
| 浏览器端到端                      | 3 个流程通过：编辑/任务/撤销/刷新，390px 手机宽度，图片导入/兼容服务工具调用                 |
| Expo Doctor                       | 21/21 检查通过                                                                               |
| Expo SDK 版本检查                 | 依赖符合 SDK 57                                                                              |
| Android/iOS/Web JavaScript 打包   | Pi 移动入口与 Git 浏览器构建打包通过                                                         |
| Android 原生 APK                  | Gradle assembleDebug x86_64 编译成功；安装到 API 36.1 模拟器                                 |
| Android 操作流程                  | 创建工作区、运行 Pi 工具、生成 summary.md、强制停止后重新打开，文件仍存在                    |

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

| 检查                   | 结果                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------ |
| 身份与模型列表         | /models 返回 HTTP 200，包含确切模型 deepseek-flash                                   |
| 文本工具闭环           | 从 notes.md 整理到 plan.md，读取保存内容核对时间、预算、饮食和联系人                 |
| 连续对话与修改         | 追问把预算从 300 改为 250，原笔记逐字保持不变                                        |
| Git 差异与恢复         | 预览本轮行程变化，撤销后与修改前全文完全一致                                         |
| 真实图片理解           | 提示中未提供图片答案；inspect_image 读取合成图片后保存 B-17、14:30 和 6 人，原图保留 |
| 页面重开               | 重开后图片提取文档内容完全一致                                                       |
| Android 原生真实调用   | API 36.1 x86_64 的原生 SSE、读取文字、保存文档和 Git 修改通过                        |
| Android 凭证与重启     | SecureStore 保存密钥后强制停止重开，不重新输入密钥，追问生成的新文档保留源资料识别码 |
| 原生可重跑脚本         | npm run test:android:live -- emulator-5556 完整通过                                  |
| 最终真实浏览器回归     | npm run test:live 通过；本轮 9 次模型请求全部 HTTP 200，协议记录合计 11,524 tokens   |
| 常规回归               | npm run check 通过，31 项测试；6 项浏览器流程通过                                    |
| 三平台 JavaScript 导出 | Android、iOS、Web 导出成功                                                           |

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

| 验证                      | 结果                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| npm run check             | TypeScript、ESLint 通过，60 项测试通过                                                                                        |
| 配置存储和迁移            | 两连接同名模型密钥隔离、失败注入、旧凭证延迟清理、幂等迁移、Origin 绑定、目录合并、删除明确选择后阻止隐式回退通过             |
| 三协议 Pi 闭环            | Chat Completions、Anthropic Messages、Gemini 分别执行真实工作区工具写入与 Git 提交，通过                                      |
| 协议细节                  | 任意字节分片、多个工具调用、截断/输出上限、流内错误、取消、认证、图片格式与授权、原生签名和调用关联通过                       |
| 目录与检测                | 分页、生成模型筛选、能力来源、内置文本/工具/图片样本核对通过                                                                  |
| 运行配置固定              | 界面取消订阅后任务继续；运行中替换密钥和参数，后续轮次仍使用原配置；新任务采用新配置，通过                                    |
| 浏览器流程                | 11 项通过；包含三协议生成/工具/图片检测和文件结果、密钥隔离、收藏筛选、复制无凭证、未保存保护、刷新缺失凭证时保留草稿         |
| 浏览器视觉                | 390px 深浅配置页经截图检查，无横向溢出；原工作台编辑、恢复、键盘快捷操作回归通过                                              |
| Android 工作台回归        | API 36.1 x86_64，编辑、未保存保护、Pi/Git 修改、强制停止重开、主题持久化通过                                                  |
| Android 配置器            | API 36.1 x86_64：三协议目录、工具/图片检测、Pi 文件写入和 Git 历史通过；重启后 SecureStore 凭证可读、未保存保护和深浅主题通过 |
| Android/iOS/Web 导出      | 三平台 JavaScript/Hermes 打包通过；不等同于 iOS 原生编译和真机验收                                                            |
| Anthropic/Gemini 官方实测 | 待提供测试凭证；本轮未调用官方服务                                                                                            |

浏览器截图：work/config-mobile-light.png、work/config-mobile-dark.png。配置器测试源码在 tests/model-config.test.ts、tests/provider-protocols.test.ts、tests/run-resources.test.ts（原 TaskManager 测试已迁到 RunKernel）、tests/e2e/model-config.spec.ts。

原生截图：work/config-android-light.png、work/config-android-dark.png，以及三个协议各自的 form/result 截图，均经视觉核对。模拟服务为 scripts/mock-model-server.mjs；操作脚本为 scripts/android-model-config.mjs。运行期间使用独立 emulator-5556，已有设备不做改动。三协议与重启检查分别重跑通过；调试自动化曾因同名认证选项、输入框被固定页脚遮挡和末行边界判断过严失败，已修正定位与滚动条件。

生成诊断每项最多 2 次模型生成、128 输出 tokens、30 秒；目录最多 20 页/5,000 条，不自动发起付费测试。服务错误正文与认证头不进入公开记录；检测失败不会被误记为能力不支持，后续编辑参数保留已验证能力依据。Gemini 无原生 ID 的调用按请求轮次分配宿主 ID，避免相同时间戳下的重试日志冲突。价格资料尚未实现，Pi 用量 cost 占位不作为费用估算。

本轮还修正原生配置页的软键盘避让；原生 UI 自动化按字段类型定位 API Key，避免把认证选项的同名文本当成输入框。调试包的硬件 R 重载干扰仍通过测试样本规避，正式包不使用该调试逻辑。

保留限制：iOS 原生、arm64 真机、真实供应商网络/账号差异、后台限制、空间不足和异常掉电仍需验证；模拟服务只能证明客户端协议和宿主执行链路。

## 项目下的多对话验证

本轮将对话从项目中拆为独立实体；项目文件和 Git 历史继续共享。每个任务冻结 conversationId，聊天上下文、草稿、附件引用和明确模型/模式选择按对话隔离。

| 验证           | 结果                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| npm run check  | TypeScript、ESLint、65 项测试通过                                                                                             |
| 迁移与失败恢复 | 旧任务迁移中断后重试、固定 main ID 保留模型 pin、保存失败保留原草稿、已提交草稿清理失败后恢复、后来编辑的新版本不被清除，通过 |
| 对话生命周期   | 归档与恢复保留内容，最后一个对话归档后创建空对话，重启不复活归档历史，运行租约阻止归档，通过                                  |
| 实际 Pi 上下文 | A → B → A 的模型请求只携带各自历史、分别选择模型/模式，任务记录包含对话和草稿版本，通过                                       |
| 浏览器         | 14 条完整流程通过；新增独立草稿/附件、刷新选择、归档恢复、旧消息迁移、运行中切换对话与请求历史隔离                            |
| Android        | API 36.1 x86_64：A/B 两对话独立消息、草稿及附件，发送任务、强制停止后恢复、归档恢复、深色与再次重开通过                       |
| 三平台导出     | Android、iOS、Web JavaScript/Hermes 打包通过；iOS 原生与真机待验证                                                            |

原生验证脚本：`node scripts/android-conversations.mjs <serial>`，需要开发客户端、Metro 和对应 adb reverse。使用演示传输，不调用付费服务。本轮仍使用独立 emulator-5556。

截图经视觉检查：work/conversations-mobile-light.png、work/conversations-mobile-dark.png、work/conversations-desktop.png、work/conversations-android-restored-draft.png、work/conversations-android-dark.png。

完整回归发现并修复项目创建结束前点击切换被忽略的问题：操作期间明确禁用项目切换。原生自动化等待开发菜单的首次提示，并区分输入草稿和添加引用后包含多行参考说明的任务消息。

边界：草稿只保证最后成功写入的版本；切换不取消任务，但仍仅运行一个任务。对话永久删除、多任务并发、分叉、跨项目移动尚未实现。

## 2026-10-14：有序工作轨迹与公开推理

| 验证                   | 结果                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run check          | TypeScript、ESLint、74 项测试通过                                                                                                                                             |
| 三协议真实 Pi 模拟循环 | 推理 → 过程文字 → 两个同名工具 → 最后一轮答案，顺序正确；toolCallId 独立配对；增量可见且最终快照持久化                                                                        |
| 协议回传               | DeepSeek reasoning_content、Anthropic thinking/signature/redacted_thinking、Gemini 原生 parts/thoughtSignature 在工具后续轮保留；轨迹不包含不透明签名与测试密钥               |
| 内容顺序               | Gemini 的文字/摘要多次交错不合并到首个文本块；Anthropic 非空初始文字块也进入轨迹                                                                                              |
| 推理参数               | off/default/on 冻结为任务快照；DeepSeek 开关、Anthropic 预算/自适应、Gemini 预算/等级映射正确；无效预算、不支持能力、Anthropic 温度约束在发送前拒绝                           |
| 取消与检查点           | 慢速存储下取消保留部分推理，任务写入串行，最终 cancelled 不被旧快照覆盖；恢复仅收束仍运行的节点                                                                               |
| 浏览器                 | 全量 18 条流程通过；三协议推理配置生效、工具详情、收起轨迹保留最后回复、刷新保留轨迹；中断恢复和旧任务兼容通过                                                                |
| 布局                   | 390px 深浅主题截图检查通过；360×500 输入区可见、无页面横向溢出                                                                                                                |
| Android 原生           | API 36.1 x86_64、独立 emulator-5556：Gemini 原生推理流、文字/工具顺序、工具输入/结果、SQLite 重启保留、深浅主题通过；生成摘要期间强制停止后恢复为 interrupted，已收到内容保留 |
| 三平台导出             | Android、iOS、Web JS/Hermes 导出通过；iOS 原生与 arm64 真机待验证                                                                                                             |

本轮不调用付费服务。Anthropic/Gemini 的官方服务验证仍待凭证，DeepSeek 新增开启推理路径也仅模拟验证；前版 DeepSeek 非推理路径的官方实测不能替代这些验证。通用 Chat Completions 推理开关方言和 Responses 尚未实现，不自动猜测模型开源属性或隐藏推理。

原生复现：启动 Metro，并用 `AGENT_MOBILE_MOCK_TRACE=1 node scripts/mock-model-server.mjs` 开启本机流式 fixture；设置 ANDROID_HOME、AGENT_MOBILE_METRO_PORT 与 adb reverse 后运行 `node scripts/android-trace.mjs <serial>`。脚本使用测试凭证、生成数据和真实本地 Git/SQLite，不访问供应商。生成中断采用确定性暂停流。

截图：work/trace-mobile-{协议}-light.png、work/trace-mobile-{协议}-dark.png、work/trace-android-light.png、work/trace-android-tool-details.png、work/trace-android-dark.png、work/trace-android-interrupted.png。截图与导出均为忽略的本地验证产物。

持久化边界：每约 200ms 合并检查点，消息/工具边界与终态立即入队；强制停止可能丢失最后尚未提交的增量，不承诺逐 token 落盘或自动续跑。

## 2026-10-14：长任务预算与系统提示词设置

默认模型请求 10 → 50 轮，工具调用 30 → 200 次，任务总时长 2 → 20 分钟，单次生成请求超时 60 → 300 秒。全局系统提示词与这四项预算、历史数量可从“设置 → Agent 设置”修改，分别恢复提示词/预算，并保存到 settings/agent。任务记录增加 agentSettingsSnapshot，固定启动时配置。

| 验证                 | 结果                                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run check        | TypeScript、ESLint、85 项测试通过                                                                                                                                                   |
| 长 Pi 任务           | 实际执行 35 次 list_files、36 轮模型请求，越过旧轮数/次数限制并完成；自定义低轮数/次数仍正确停止并指出对应上限                                                                      |
| 请求与任务超时       | 使用可控时钟验证 75 秒流式请求可完成，显式 10 秒请求超时仍停止；任务总时长到期标为 failed 并保留部分推理，主动取消的原回归通过                                                      |
| 系统提示词与配置版本 | 设置保存/重开恢复、冻结快照、保存失败保持旧值、并发旧 revision 拒绝；运行中修改后，当前任务两轮请求仍用原提示词，下一任务采用新提示词和预算                                         |
| 大文字资料           | 200,000 字符/600 KB UTF-8 文本通过真实工具写入与 Git 提交；超过旧 512 KB 的 SSE 响应正常解析；分页读取返回准确 offset/nextOffset/totalCharacters 与完整文件修订号；超过 1 MB 仍拒绝 |
| 草稿、历史、模型上限 | 16,000 字符草稿保存通过，16,001 拒绝；携带 8 条历史，设为 0 后不携带；32,768 输出可配置，供应商公布更低值仍拒绝                                                                     |
| 浏览器               | 21 条流程通过（首轮 20 条通过，旧默认输出断言更新后剩余 1 条定向重跑通过）；新增 Agent 设置保存、刷新、错误校验、未保存保护、深浅/短视口、运行快照和 6 MB 图片导入/刷新持久化       |
| Android              | API 36.1 x86_64，独立 emulator-5556：系统提示词及 80 轮/300 工具/30 分钟/600 秒保存、强制停止重开恢复，未保存保护、演示任务、深浅主题、独立恢复默认预算并再次重开，通过             |
| 三平台导出           | Android、iOS、Web JS/Hermes 打包通过；iOS 原生与 arm64 真机待验证                                                                                                                   |

网络与内容限制同时提高：请求体 8 MB、SSE 响应 4 MB、单轮 32 工具、单次文字工具 240,000 字符、文本文件 1 MB、系统导入与浏览器导入 20 MB、模型图片 4 MB；像素上限仍为 2,400 万。新模型默认输出 8,192、可配置至 65,536，目录公布更低上限时继续约束；已有模型参数不迁移覆盖。

原生复现：设置 ANDROID_HOME、AGENT_MOBILE_METRO_PORT，启动开发客户端和 Metro、配置 adb reverse，再运行 `node scripts/android-agent-settings.mjs <serial>`。本轮使用本地模拟协议与演示，不消耗真实供应商额度。

视觉检查：work/agent-settings-mobile-light.png、work/agent-settings-mobile-dark.png、work/agent-settings-android-light.png、work/agent-settings-android-dark.png。390px 深浅主题和 360×500 视口均可用；原生保存按钮固定，软键盘与表单滚动正常。

边界：供应商的上下文、输出、图片和限流约束仍适用；历史以字符量保守预留空间，精确 tokenizer、当前任务自动摘要压缩、后台常驻和自动续跑尚未实现。提示词编辑只改变模型行为描述，受控路径、版本校验和宿主工具权限继续执行。

## 2026-10-14：Agent 执行期间的资料实时刷新

修复原先只有任务结束才刷新资料的问题。工作台订阅 WorkspaceService 的已完成文件操作；每次 Git/操作日志记录成功后更新列表、版本和打开文档。读取快照与文件写入使用同一项目队列，连续通知在一次读期间合并，刷新不跟随每个模型 token。

| 验证           | 结果                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm run check  | TypeScript、ESLint、88 项测试通过                                                                                                                                  |
| 变更事件       | 创建/保存即时通知，已 recorded 的重试不重复通知；观察者抛错不破坏已提交写入；记录失败不发成功通知，恢复补记后才发布                                                |
| 读取与修改交错 | 在移动“已移除旧路径、尚未写入新路径”处暂停写入；只读快照等待操作完成，返回的文件/预览/Git/操作日志一致，通过                                                       |
| 浏览器完整回归 | 24 条全量流程通过；补充启动导航测试定向通过，实时相关 4 个场景均验证通过，合计 25 条覆盖                                                                           |
| 执行中的资料   | 模拟供应商保留最终响应未结束：第一版文件可见、打开文档更新第二版、版本数更新、移动及删除反映到列表，原路径预览关闭；此时“停止任务”仍可见                           |
| 项目和草稿     | 后台项目写入期间，另一个项目的未保存正文保留且无串入文件；切回执行项目可读新资料                                                                                   |
| Markdown 图片  | 文本本身未变时，引用图片删除会失效重载，旧图片消失并显示不可用；任务继续运行                                                                                       |
| 启动导航       | 发送后立即切到资料，启动完成与任务完成均不强制切回会话，通过                                                                                                       |
| Android        | API 36.1 x86_64、独立 emulator-5556：任务最终回答被 fixture 暂停时，新建文件已出现在资料；打开预览从第一版更新第二版；随后完成任务，强制停止重开仍保留第二版，通过 |
| 三平台导出     | Android、iOS、Web JS/Hermes 打包通过；iOS 原生与 arm64 真机待验证                                                                                                  |

原生验证：启动 `node scripts/mock-workspace-live.mjs`，配置 Metro/ANDROID_HOME/AGENT_MOBILE_METRO_PORT 与 adb reverse，运行 `node scripts/android-workspace-live.mjs <serial>`。本机 fixture 提供两个写入和手工释放后续响应的门控，不调用付费服务。若测试过程已进入等待后续响应阶段，--resume 只继续资料验证，不能用于重开已停止的 Agent。

截图经视觉检查：work/workspace-live-reading.png、work/workspace-live-android-reading.png，均能看到 Agent 仍运行而预览已显示第二版。

原生检查同时发现并修复异步启动结束时导航覆盖用户选择的时序问题：会话标签选择提前到任务启动前，之后保持用户选中的资料/版本页面。自动化等待连接保存后的路由重建完成；多轮写入 fixture 使用独立工具调用 ID。

边界：刷新展示已成功写入的版本，不展示文件操作应用中的中间状态；有未保存正文或名称时保留草稿并标记新版本，不静默覆盖。应用外部文件监视、多页面协作尚未实现。

## 2026-10-14：远程 MCP

手机作为客户端连接 Streamable HTTP 服务器，官方客户端锁定 2.3.1。实现范围见 [remote-mcp.md](remote-mcp.md)，入口为“设置 → 远程 MCP”。本轮使用本地可控 MCP/模型服务，不访问付费供应商。

| 验证           | 结果                                                                                                                                                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run check  | TypeScript、ESLint、104 项测试通过；新增 16 项 MCP 验证                                                                                                                                      |
| 官方 SDK       | 2026-07-28 server/discover/逐请求元数据，以及 2025-11-25 initialize/session 回退；JSON/SSE、分页和进度通过                                                                                   |
| 项目授权       | 默认关闭、项目隔离、目录变更撤销授权、未授权工具不进入模型请求；实际 Pi 远端查询 → 本地 write_text → Git 提交通过                                                                            |
| 配置/凭证      | 冻结工具/参数/Token 租约，替换或删除后旧 Token 等租约释放再清理；保存失败与初始化清理恢复通过；参数预览、返回结果、定义与任务快照无测试 Token                                                |
| 失败与恢复     | 参数/定义校验在发送前拒绝；发送日志失败不联网；HTTP 认证拒绝与未知执行区分；取消/超时/超大回执/保存回执失败均保留未知状态，同参数不自动重发；prepared/dispatched 重启收束通过                |
| 浏览器完整回归 | 29 条全量流程通过；包含两代 MCP、配置/授权、工作轨迹、刷新缺失 Token、深浅主题、未保存保护、未知记录与删除连接后核对                                                                         |
| Android 原生   | API 36.1 x86_64、独立 emulator-5556：两代 SSE MCP 真网络调用、Token 重开保留、Agent/Git 文件、进度、发送后强制停止恢复为 interrupted/unknown、显式解除重试限制通过                           |
| 原生持久化证据 | 直接读取隔离模拟器 SQLite：两代调用均有 completed 回执、匹配 completed 工具轨迹及不同 base/final Git commit；暂停调用保留 unknown 回执和 interrupted 任务，核对时间已记录；任务/回执无 Token |
| 三平台导出     | Web、Android/iOS JS/Hermes 导出通过；Expo Doctor 21/21 通过；iOS 原生、arm64 真机与真实外部 MCP 服务待验证                                                                                   |

完整浏览器回归发现并修复内置工具标签变化和删除连接后编辑页卸载导致导航未完成的问题。原生自动化最初误点被页脚遮住的授权开关，已改为定位可交互控件并检查完整可见范围及 checked 状态；同时通过模拟服务器调用计数和原生 SQLite 回执确认真正执行，不能只依赖模拟模型的完成回复。

原生复现：`node scripts/mock-mcp-server.mjs` 启动本机 4181 fixture；配置 ANDROID_HOME/AGENT_MOBILE_METRO_PORT、开发客户端和 adb reverse，运行 `node scripts/android-mcp.mjs <serial>`。SDK schema 校验器会标注输入定义，因此编译前复制 schema，保持任务快照不可变；Metro 为 SDK 和 PKCE 使用浏览器入口，避免 Node 默认分支。

截图经视觉检查：work/mcp-mobile-light.png、work/mcp-mobile-dark.png、work/mcp-android-tool.png、work/mcp-android-restored.png、work/mcp-android-unknown.png。布局延续紧凑工具界面，配置固定保存区，远端步骤按时间显示。

边界：首版只支持无需认证/Bearer Token 与完整 HTTPS 端点（loopback 可 HTTP），尚无 OAuth、自定义 Header、旧 SSE 双端点、stdio、Resources/Prompts 浏览、Tasks、MCP Apps、sampling/roots/elicitation 或后台常驻。未知状态采用保守语义，远端 exactly-once、幂等键和业务撤销未实现。删除/重建连接不会绕过同端点/工具/参数的未知记录。

## 2026-10-14：Agent Skills

接入通用 SKILL.md、Markdown/ZIP 导入和独立 Git 技能库。用户从“设置 → Agent Skills”管理内容与项目启用，输入区提供“选择技能”。实现和兼容范围见 [agent-skills.md](agent-skills.md)。本轮使用本地模拟模型，不调用付费服务。

| 验证                   | 结果                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run check          | TypeScript、ESLint、118 项测试通过；新增 14 项技能验证                                                                                                                              |
| 格式与导入             | YAML 块标量、BOM/CRLF、可选元数据、多技能 ZIP、目录规范化、导出再导入通过；重复字段、错误类型、别名、越界、重复大小写路径、嵌套技能与超限拒绝                                       |
| 解压边界               | 不仅校验声明大小；伪造 ZIP 大小字段后，实际输出超过限制仍被流式检查拒绝，通过                                                                                                       |
| Git/SQLite 与恢复      | 多文件写入中断后日志恢复；Git 已提交但技能配置未保存时重新扫描；更新撤销旧启用、历史恢复新提交、内部库不进项目列表通过                                                              |
| 版本固定               | 任务捕获旧 Git commit 后，编辑或删除技能仍可读取旧正文与资源；引用文件变化也改变技能版本，旧页面/预览提交被拒绝                                                                     |
| 三协议真实 Pi 模拟循环 | Chat Completions、Anthropic Messages、Gemini：首轮仅目录 → load_skill 正文 → read_skill_resource 引用 → write_text/Git 保存；未启用技能正文不进入模型请求，通过                     |
| 明确调用与上下文       | $技能名 由宿主首轮注入并保存加载轨迹；重复加载去重、下一任务不携带旧技能正文、未启用调用保留草稿、普通金额不误识别，通过                                                            |
| 浏览器                 | 32 条全量回归通过；补充防护修改后的 3 条技能流程定向重跑通过；覆盖导入/编辑/引用、启用/撤销、自动与明确调用、历史/导出/删除、未保存保护、深浅/短视口、运行期间更新与删除            |
| Android                | API 36.1 x86_64、独立 emulator-5556：系统文件选择器导入 ZIP、项目启用、实际 Pi 自动加载/引用/Git 文件，重启后资源编辑/重新启用、明确调用读取新资源、深色与版本历史，分段验证通过    |
| 原生持久化证据         | 隔离模拟器 SQLite 验证自动/明确激活、completed 资源轨迹和 Git 修改；资源更新前后任务技能 revision 不同，重新启用已保存；技能库没有出现在用户项目表，导入/更新操作均有 recorded 回执 |
| 打包与依赖             | Web、Android/iOS JS/Hermes 导出通过，Expo Doctor 21/21；iOS 原生与 arm64 真机仍待验证                                                                                               |

原生自动化修复了两处测试干扰：Modal 输入中的重复 R 键会触发开发客户端重载，因此改用不触发快捷键的样本文本；编辑弹窗内的硬件 Back 会触发关闭/未保存保护，改为直接点击键盘上方的应用按钮。版本行包含修订号，等待改为匹配“当前版本”片段；截图等待正文加载后再捕获。原生数据库与模拟服务实际请求共同验证结果，不能只依赖完成回复。

复现：启动 `node scripts/mock-skills-server.mjs`，设置 ANDROID_HOME/AGENT_MOBILE_METRO_PORT，配置开发客户端和 adb reverse，运行 `node scripts/android-skills.mjs <serial>`。持久化核对可独立执行 `node scripts/android-skills-records.mjs <serial>`。脚本使用隔离 fixture 与生成数据。

截图：work/skills-mobile-light.png、work/skills-mobile-dark.png、work/skills-android-library.png、work/skills-android-trace.png、work/skills-android-dark.png、work/skills-android-history.png。深浅界面与原生历史截图经过视觉检查，技能加载与资源读取沿用有序轨迹。

边界：脚本只读不执行、其他二进制资源只保留供导出，allowed-tools 不增加工具权限。远程市场/自动下载、原生目录扫描、改名/分叉、已删除技能恢复、签名与容量清理尚未实现；演示模式不会理解技能语义。当前未做自动上下文压缩，未来必须保护已激活技能内容。

## 2026-10-14：传统 Git 工作流

项目文件从逐动作自动提交升级为工作区/index/HEAD 分离，实施说明见 [git-workflow.md](git-workflow.md)。本轮使用演示与模拟模型，没有调用付费供应商。

| 验证              | 结果                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm run check     | TypeScript strict、ESLint、130 项 Vitest 通过；新增 12 项 Git 工作流回归                                                                                                             |
| 标准 Git CLI      | 连续保存不移动 HEAD，私有引用不进入普通 log；暂存 v1 后编辑 v2，提交与 index 仍为 v1，工作区 v2 为未暂存；选择性提交保留其他已暂存内容；重命名/删除/取消暂存与 CLI 状态一致          |
| 冲突与恢复        | 陈旧 HEAD/index/文件指纹、空提交、非法提交说明拒绝；index 批次部分写入、提交成功但数据库回执失败、内部检查点回执失败可恢复；旧无 kind 自动提交日志仍恢复，旧历史保持                 |
| 任务与 Agent      | 普通 Pi 任务不提交；明确 Git 工具循环生成一个提交；任务前已有脏文件可编辑，但 Agent 暂存/取消暂存/提交被拒绝；任务撤销恢复原工作区/index，保留无关文件与公开历史；后续冲突阻止撤销   |
| SQLite 查询顺序   | 打乱 ID/写入顺序后，任务恢复仍按 sequence 采用最后文件/index 检查点；纯暂存区变化也有预览、待提交提示与撤销                                                                          |
| 浏览器            | 35 条全量 Playwright 回归通过；Git 覆盖暂存后再编辑、刷新保留 index、明确提交、两类差异、取消暂存、脏工作区拒绝历史恢复、恢复不增加提交、未跟踪文件丢弃、手机深浅主题与短视口        |
| Android           | API 36.1 x86_64、隔离 emulator-5556：暂存 v1 后强制停止重开、编辑 v2、预览差异并提交 v1、演示任务只生成未跟踪资料、再次重启与深浅主题通过                                            |
| 原生仓库与 SQLite | 导出本轮合成项目的原生仓库，用系统 Git 验证公开历史仅 2 个提交、HEAD/index 为 v1、磁盘为 v2、summary 未跟踪、检查点有独立引用；SQLite 任务快照与 recorded 文件/index/commit 回执一致 |
| 原生提交恢复      | 在停止的隔离应用数据库中把已完成 commit 回执改回 prepared 并移除 commit 字段，重新启动后补记为 recorded；再次导出仓库仍仅 2 个提交，v2/summary 保留；分段验证通过                    |
| 构建              | Web、Android/iOS JavaScript/Hermes 导出通过；本轮未修改依赖/Expo 配置，沿用上一轮 Expo Doctor 21/21。iOS 原生与 arm64 真机待验证                                                     |

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

## 2026-10-14：架构 v2 R2 实际接入

实际启动、上下文历史、草稿回执和启动恢复已改用 RunKernel/RunRepository；新执行不再写旧 tasks。新增 11 项验证，npm run check 共 152 项通过：冻结配置/延迟文件基线、精确草稿消费、准备/排队/初始执行槽取消、队列上限、终态保存失败、陈旧进度拒绝、单一资源清理、组预算并发预留/截止时间/存储失败、Pi 在工具等待前释放请求槽以及排队请求取消。

36 条完整浏览器回归通过。迁移回归发现旧对话标题与缺失轨迹提示被 v2 投影丢失，修复后重跑通过。键盘流程在发送按钮就绪后验证 Enter，避免初始项目尚在加载时发送。

Android API 36.1 x86_64 隔离模拟器：android-smoke 的编辑/未保存保护、实际 Pi 工具、重启、主题通过；android-runs 核对实际 runs-v2、launch、transcript、4 次模型请求/3 次工具预算和无旧 tasks 双写。通过 SQLite trigger 在 run-migrations 写入点注入异常，验证 run/launch/trace/marker/索引全部回滚且来源保留；移除 trigger 后重启迁移完成。合成非终态父/子/排队运行收束 interrupted，公开轨迹与活动索引恢复，已消费草稿清理，文件操作数不增加。恢复树测试不是子 Agent 执行验证。

Web 与 Android/iOS JS/Hermes 导出通过。本轮未改依赖/Expo 配置。iOS 原生与 arm64 真机待验证。复现原生验证：隔离开发客户端/Metro/adb reverse 就绪后运行 `node scripts/android-smoke.mjs <serial>`，再运行 `node scripts/android-runs.mjs <serial>`；后者只能用于合成测试设备，会注入测试记录与失败 trigger。R3–R5 尚未交付。

## 2026-10-14：架构 v2 R3 只读子 Agent

156 项测试通过：固定快照隔离父后续写入、独立上下文与工具 grant、同 invocation 去重/参数冲突/跨运行拒绝、两并行/四总数、定向与递归取消、child/receipt/预算事务中断重试、子额度和父汇总保留。新轨迹保存 run/root/parent 身份、单运行与组内宿主序号。

37 条完整浏览器回归通过，另执行两个委派专项（38 个独立流程）：真实 Pi 创建两个子任务、只读工具集合、无自动复制父上下文、父等待不占槽、子结果先持久化、父引擎自动继续汇总、折叠轨迹与刷新；wait_agents 显式等待过程中通过 UI 只取消 A，B 继续完成并回传取消事实。

Android API 36.1 x86_64 隔离模拟器运行本地 delegation-fixture，实际两个子 Pi 模型/只读工具闭环通过，服务测得并发模型请求最多 2。SQLite 核对同输入快照、独立 transcript、父轨迹子链接、组预算与公开汇总；另验证根任务递归取消及等待中强制终止后父/子均 interrupted。没有付费模型请求。复现：启动 `node scripts/delegation-fixture.mjs`、隔离开发客户端/Metro，并配置 ANDROID_HOME/AGENT_MOBILE_METRO_PORT，运行 `node scripts/android-delegation.mjs <serial>`；脚本只用于合成设备，会添加本地无认证模型配置。

Web 与 Android/iOS JS/Hermes 导出通过。iOS 原生/arm64 真机仍待验证。R4 多根并发、共享 MCP 调度屏障和 R5 隔离写入提案尚未交付。

## 2026-10-14：架构 v2 R4 不同项目并发

159 项检查通过。新增双项目两根并发/同项目另一对话排队/定向取消与预算隔离、MCP 跨运行同参数在途与 unknown 屏障、同连接两凭证租约回收验证。Android SQLite batch 与普通写入共用串行写队列，读取保持 WAL 语义。

40 条完整浏览器回归（4 workers）通过：多个活动任务展示与跳转、当前对话定向取消、另一组仍活动时完成历史立即更新、同项目发送入队并显示取消排队；既有 Git、协议、MCP、Skills 和子 Agent 通过。初次 8 workers 加原生/三平台导出并行时，出现浏览器导航超时与旧单元轮询的短超时；降低该轮验证负载后现源码全部通过。活动任务条使“等待子任务”出现两个位置，专项断言已限定会话区域。

Android API 36.1 x86_64 隔离设备：两个项目先后保存 documents/parallel.md，各自等待下一模型响应，fixture 测得两请求并发；停止 B 后 A 继续完成。另两个项目同时等待时 force-stop，重开二者均 interrupted；SQLite 校验四个独立项目、文件回执归属、completed/cancelled/interrupted 终态与空活动索引。原生脚本在释放模型前先导航到任务，避免任务完成后活动按钮消失造成自动点击竞态。

Web 与 Android/iOS JS/Hermes 导出通过。复现：沿用 android-delegation 的本地无认证模型设置、delegation-fixture 与隔离设备，运行 `node scripts/android-parallel.mjs <serial>`；勿用于用户设备。iOS 原生/arm64 真机待验证。R5 尚未交付。

## 2026-10-14：架构 v2 R5 隔离写作与原型验收

166 项检查通过。新增候选隔离（真实文件/index/HEAD 不变）、授权/稳定回执/跨根拒绝、任务前脏文件/index 保留、内容贡献归属、整组撤销、不夹带用户改动、整批冲突/no-op、图片移动/删除、候选 Git 成功但 SQLite 回执中断恢复、合入第二文件中断恢复、文件已 recorded 但提案回执未保存时的组完成屏障、子终态取消竞态。Facade 对提案只开放 preview，禁止 UI 获取仓库或直接合入。

41 条完整浏览器回归（4 workers）通过；新 Pi writer 协议模拟闭环验证隔离候选实时查看、父 get_proposal/apply_proposal、合入前真实资料不变、提交历史不增加、根撤销恢复用户原有未提交内容。三平台 Web/Android/iOS JS/Hermes 导出通过，未修改依赖/Expo 配置。

Android API 36.1 x86_64 隔离模拟器分段验证：实际 writer Pi 在私有候选生成两份文稿，界面查看候选时真实原文/文件列表不变；父合入后 SQLite 验证 root/child 完成、proposal applied、ownerRootRunId/actorRunId/mergedByRunId，HEAD 保留、merge 不包含 indexChanges；根撤销通过。再在 merge recorded 的 SQL 写入点注入 trigger 异常，界面不发布 completed；移除 trigger 后重启，恢复文件日志与 proposal applied，root interrupted/child completed，根最终变化包含两条路径，没有模型重放。Base/final index 检查点引用不同是私有提交说明的差异，不能把引用 OID 不同当成真实 index 内容变化。

复现：本地 delegation-fixture、已配置本地无认证模型的隔离开发客户端，运行 `node scripts/android-proposals.mjs <serial>`；`--fault` 仅执行回执故障段。模拟器输入含重复 R/r 的模态文本可能触发开发客户端重载，测试项目采用不含 Recovery 的名称。合成 SQLite/日志/截图保存在 work/，不提交。已停止本轮模拟器、Metro、fixture，保留用户 4180 预览服务。

R0–R5 行为与迁移/失败路径验收完成。当前仅内置角色/父模型继承；IntelligentUI/WebView、后台服务、角色编辑/子模型选择、libgit2、token/费用硬预算、自动压缩、自动三方合并与 GC 尚未实现。iOS 原生/arm64 真机未验证；普通进程中断与失败注入不证明真实断电/fsync 保证。

## 2026-10-14：重构遗留与依赖清理

移除 10 个旧生产模块：TaskManager/startAgent、旧模型传输/检测、旧单任务预算、prototype/workbench 转发与固定主题；控制器不再回退到旧 tasks/transcripts 写入。保留模型配置、会话、任务与 transcript 的旧数据迁移。原集成测试使用 RunKernel/v2 仓库；终态发布的重复测试合并到已有内核验证，并补保留初始视图不被后续执行修改的断言，订阅者异常隔离测试迁到 AppServices。

`npm run check` 通过（165 项测试；原 166 项中合并 1 项重复验证）；41 条 Playwright 浏览器回归通过（4 workers），覆盖协议、推理、预算、取消、Git、实时资料、并发、子 Agent、writer 提案、MCP、Skills 与旧数据迁移。开启 `noUnusedLocals/noUnusedParameters`，静态引用检查没有剩余孤立 src 模块；文件路由、Metro Pi alias、Web 平台实现按隐式入口保留。

删除未接入的 image-picker/image-manipulator 和应用直接 Zod 依赖；MCP SDK 继续使用锁定的传递 Zod 版本。保留 Router 所需 Reanimated/Worklets/Gesture Handler。Expo Doctor 21/21、原生配置 introspection、Web/Android/iOS JS/Hermes 导出通过。清理 17 个未引用模板素材，使用中的六个应用图标/启动素材路径仍有效。未重跑原生安装与模拟器操作；没有修改 SQLite、Git 或原生桥接实现。本轮只使用模拟协议，没有调用付费模型。

## 2026-10-14：改进方案第一阶段（整体仍在执行）

统一 StopReason/终态判定，宿主错误改为 AppError；删除错误子类与 UI 中文前缀正则。所有工具显式声明 effect，冻结角色参与工具构建/派发；静态边界覆盖 alias、相对路径、类型、动态 import 与 require。目录实际由 65 个收敛到 44 个子目录（含新建的真实存储模块，仍需最终盘点），没有旧路径转发文件。

OperationJournal 使用明确 projects/skills namespace，以及独立 header/body/counter。prepare 的序号、摘要、不可变正文在同一数据库事务分配/保存；phase 更新验证 revision 与意图不变；recorded 与项目元数据同批写入。摘要/归属/任务最终状态查询不读取正文，恢复逐项目/按序读取未完成正文，失败阻断该项目。Skills 显式 files_commit 固定目标快照；删除 automaticCommits、缺失 kind 分支及旧格式恢复测试。补验证 Git 成功但技能回执失败时冻结、重开不增加第二个版本，以及摘要读取禁止正文的故障注入。

删除旧模型配置/凭证入口、旧任务/transcript 迁移、旧对话补写。启动修复草稿只查询精确 accepted-drafts 回执；它与运行准入同批提交。当前 SQLite/IndexedDB 格式为 agent-mobile-f1，不建立升级/降级链。格式不匹配时显示开发重建入口，确认前不清理；入口仅在内核未建立时可用，重建作用于此应用 DB/工作区/Git，设备 SecureStore 凭证、其他应用和外部服务不在范围。

截至该阶段：npm run check 通过（25 套、173 项测试）；Web 导出通过；40 条完整 Playwright 回归通过（三模型协议、两代 MCP、Skills、Git、根/子 Agent、实时资料）；开发重建入口新增后，补跑格式/工作台回归，结果见后续记录。没有使用真实 API Key 或付费模型。未修改依赖/Expo 配置。

node scripts/storage-current-format.mjs 执行实际 source adapter：Node SQLite 验证当前结构创建/重开、prepared+counter 回滚、并发 105 个序号、重复 ID、header-only 分页、跨表 revision 冲突回滚和格式不匹配；真实 Chrome IndexedDB 验证 105 条并发意图、重复 ID、事务回滚、30+30 分页、100 条恢复顺序、查询只触及 header store、实例身份稳定与旧格式阻断。Node SQLite 桥接夹具不能证明 Expo SQLite/Hermes 或 Android 真机行为；当前没有运行中的 Android 模拟器。

node scripts/storage-range.mjs：Chrome 155.0.8059.41，Windows x64，隔离实例 3,000 个紧凑摘要和另一 bucket 32 × 128 KiB 独立正文，总约 4 MiB。各 5 次：键范围查询中位 15.9 ms、最大 16.7 ms；旧全库复制/过滤中位约 25.8 ms、最大 27.5 ms。两组先后执行、有缓存和 GC 影响；heap 35.2 MB 是一次读数，不是峰值或对照结论。本结果验证读取范围收敛，不能外推到冷启动、全项目刷新、1/4/20 MB 混合样本或真机收益；完整性能样本仍待后续交付。

运行 v3/摘要与详情/底层分页、trace/text chunks/transcript frames、ExecutionDriver、共享 ScopedFileReader、窄 workbench/API 和原生验证尚未完成。第一阶段的绿灯不代表整个十批次方案已验收。生成 DB/测量结果/截图在 work/，未提交；用户 4180 预览服务保持运行，预览已更新。

## 2026-10-15：运行摘要、分页与持续写入

运行列表改为独立 RunSummary/RunDetail/RunView 和 RunsApi；废弃 TaskRecord 展示/实体耦合及完整 tasks 查询。私有执行快照命名 ExecutionView，移除 events 镜像；AppServices 只投影公共显示字段，任务差异/撤销输入改为 runId，在业务层加载可信记录。当前工作台 FlatList 初始渲染 3 项、首批 30 条摘要，可见项再读取详情，子正文展开后读取。后续步骤/正文有独立分页入口。

GitPort.historyPage 固定 HEAD，后页按提交 OID 继续，默认 30/上限 100；此产品当前只有线性提交链，无合并功能。Git/Skills 界面增加加载更多；Skills 扫描到足够相关版本或链结束，复用同一修订算法，不只检查最近 30 次库提交。findOperation 逐页搜索完整提交标记，超过 100 条和相似 ID 测试通过。

数据格式更新为 agent-mobile-f3（SQLite/IDB 物理版本 4），没有格式迁移链。trace_nodes、trace_text_chunks、transcript_frames 各自有索引；节点更新检查 revision/归属/终态，文本块验证连续 ordinal、UTF-16 offset/长度，帧验证版本/连续序号/同键一致。Recorder 每次仅提交 dirty 节点、新块与未保存帧；流式进度不重写完整回答。Pi 对 message_end 保存单条消息，系统/历史种子各一次，取消尾部继续保存，没有每轮 deep clone agent.state.messages。终态与轨迹尾部/帧同库原子写入；持续写链错误仍阻断后续写入/完成。界面通知与 200ms DB 合并独立。

发现并修复真实收尾竞态：引擎返回后，尚存的自动保存定时器可能在最终工作区快照结束前保存 completed，使最后快照被终态保护忽略。根/子进入收尾就关闭自动刷新，然后完成特有快照/候选收束，再提交终态。

npm run check 通过（26 套、179 项），Web 导出通过，41 条完整浏览器回归通过。新验证覆盖增量块不重写、摘要不读正文、12000 UTF-16 分页代理对、终态/尾帧同批、旧进度及重复帧冲突。实际 SQLite/IndexedDB source adapter 测试进一步通过文本范围查询、重复块/帧冲突、帧顺序与终态批次；生成结果在 work/validation/current-format.json。没有调用付费服务。Android/iOS 当前批次的原生桥接、故障注入与完整性能样本仍待验收；前一阶段 Android Hermes 导出不能代替本阶段运行验证。

## 2026-10-15：共同驱动、受限读取与原生当前格式

根/子通过同一 ExecutionDriver 管理 EngineSession、请求槽/配额、派发前检查、持久化意图、effect/角色授权、停止订阅与计时器/permit 清理；根保留项目租约、委派汇总与文件快照，子保留候选收束与配额释放。驱动不接收 WorkspaceApplication。live/snapshot/proposal 都使用 ScopedFileReader 与一套 schema/分页/文字/搜索/图片算法；快照无写端口，提案读授权候选，跨页来源/版本变化报 CONFLICT；list_files 改为 files/cursor/source，演示与测试调用者同步更新。

snapshot 的 file/status/preview 共用一次内容读取，workingTree 直接遍历读取一次，必要 Git 全树成本保留。新增真实 I/O 计数验证一次刷新每份文件只读一次；新增跨页版本/grant、分页搜索/取消测试。AppServices 公开契约改为显式接口，没有 Pick<ServiceClass>；UI diff/undo 只提交 runId，业务查可信记录。editor/composer 各有唯一 ref+state 写入入口，外部 ref 只读；保存完成核对当前文档身份，保留后来输入，离开前再次核对未保存内容。窄 workbench 六组能力和文件描述索引尚待完成。

npm run check：27 套、182 项通过。Web 最新完整回归先发现一个旧测试仍把 list_files 当数组；按新契约更新后，资料实时更新/引用图片删除 4 条回归通过。其他 40 条完整回归此前通过；编辑入口改动后仍需对应 UI 验证，不能把此前结果当作它的验证。

Android API 36.1 x86_64，Medium_Phone_API_36.1 的只读隔离实例，emulator-5572；不清原 AVD 数据。安装现有 SDK 57 development APK，通过 Metro 8082 加载当前源码；Metro 只监听 ::1，使用本地 IPv4 8083→::1:8082 代理与 adb reverse 修复客户端连接。没有为连接问题修改产品依赖/Expo 配置。原生实际编辑 notes.md、保存后离开、Pi 演示工具生成 summary.md，强制停止/重开后两份内容保留。FlatList 完成状态可能在视口外，smoke 改为等待发送按钮恢复；原先等待已完成文本的超时不是运行失败，SQLite 随后核对真实终态。

node scripts/android-runs.mjs emulator-5572 对该隔离实例读取真实 SQLite/Git：当前 Run v3、独立 trace 节点/文本块、transcript frames、4 次模型请求/3 个工具；注入未完成根/子/排队及精确草稿回执，重启后均 interrupted、活动索引清空、正文/轨迹保留、草稿清理且操作日志数不增加，未重放模型/文件工具。该项不能代替真实断电、事务 trigger 回滚、writer/Skills/MCP unknown 新格式原生验证或真机性能。
2026-10-15 本批补验：编辑入口/保存基线改动后，7 条 workbench 浏览器回归通过；npm run check 仍为 27 套、182 项通过，git diff --check 无空白错误。尚未完成的具体项保持原范围：文件描述索引与失效验证；工作台按 conversation/editor/files/git/runs/dialogs 六组契约收敛；完整性能三样本/至少五次测量；当前原生 schema 的事务 trigger 失败、Skills/writer/MCP unknown 验证；iOS JS 导出与原生限制说明；最终逐项完成审计。未创建提交或 PR。

## 2026-10-15：目录、界面能力与当前格式的最终收敛

文件描述索引只缓存路径、大小、MIME 与真实 Git 修订，不缓存正文。Web 的 stat 从 IndexedDB 复合索引读取轻量键，内容版本 UUID 与实际文件同一行原子更新；Native 校验真实 MD5 内容指纹，仍需要读取文件，减少的是 JS 字节复制/重复 Git 哈希，不承诺原生物理 I/O 为 O(1)。没有可信指纹时每次重新读取。当前操作 recorded 后验证并暖索引；冷启动/恢复失败清空索引；未知同大小同时间内容变化也重新验证。保存、提案合入的写前内容检查未被缓存替代。

数据格式为 agent-mobile-f4 / SQLite、IndexedDB 物理版本 5。旧实例阻断并提示明确重建，未加入历史读取或迁移链。Android 实测发现并修复开发重建路径问题：SQLite 给出本地路径，Expo FileSystem 的 File 需要 URI；失败标记仍阻断不完整实例，修复后原生中断重建可以重试成功。Web versionchange 关闭旧连接，后续访问返回带刷新提示的 CONFLICT。实际 source adapter 进一步验证初始化 DDL/格式标记/物理版本在同一 SQLite 事务回滚，当前格式重试初始化、序号/正文/CAS 回滚、trace/chunk/frame 原子写入与关闭提示。

工作台输出 conversation/editor/files/git/runs/dialogs 六组能力。稳定动作绑定在提交后的界面状态，组件仅接收所需组并用 memo 隔离无关分片；活动指示器不持有整棵 trace。运行事件不触发文件/Git 查询，只有当前项目的 recorded 工作区通知刷新资料。查询范围变更立即隐藏旧文件、Git 状态、操作和对话列表，新范围查询返回前不展示旧数据。真实 IDB 阻塞回归验证这条边界。

editor/composer 均通过唯一入口写入 ref+state；editor 会话身份使用 Symbol，旧保存回执不会命中重新打开的同名文档。保存过程中输入保留并继续显示未保存状态；保存后离开重新核对最新输入。公共详情只读取 header/input/result，不加载冻结工具/供应商或 opaque provider 消息。长轨迹首 50 节点不影响最终回答可见性，长回答初始 12,000 UTF-16 单位、按需展开。SerialQueue 只统一可恢复失败的普通命令队列；Recorder sticky 失败链、请求公平队列和需要特别收束的队列保留自身语义。JSON DTO clone/freeze 仅用于已经校验的业务 DTO，不处理能力、字节、租约或 provider 消息。

src 子目录从原 65 个收敛为 43 个，空目录为 0；没有旧路径转发或预建未来框架。AppServices 为显式契约，边界检查、未使用声明检查继续生效。关键停止、驱动、事务、恢复和并发代码展开为可阅读的块。原外部审计报告保留原文。

当前格式 Android/Hermes 实存验证通过：两个 Pi 只读子 Agent、同输入快照、并发请求最多 2、结果汇总、递归取消与强制中断恢复；writer 候选隔离、主合入/归属、真实 index/HEAD 保护、整组撤销；合入 recorded 的 SQLite trigger 故障阻止虚假完成，重启恢复原回执且不重放模型。Skills 实际 ZIP 导入、懒加载/明确加载、冻结版本、资源更新、历史和重启通过；额外 trigger 在 Git 已成功后令 recorded 失败，验证项目元数据回滚、原操作恢复和 HEAD 不增加第二个版本。MCP 2026/2025 SSE、原生进度、工作区写入、强制中断 unknown、人工解除重试屏障及 Token 不进入元数据通过。

复现脚本：android-delegation.mjs（--verify 可只核对已保存的合成 DB）、android-proposals.mjs、android-skills.mjs、android-skills-fault.mjs、android-mcp.mjs；只对 emulator-5572 的只读隔离实例运行。本轮没有使用真实 Key 或付费模型，未清理凭证或原 AVD 数据。依赖与 Expo 配置未改变。iOS 仅 JS/Hermes 导出验证，iOS 原生与 arm64 真机未验证；进程中断与事务 trigger 不证明真实断电/fsync 保证。

## 本轮性能验收与实际限制

三个隔离样本分别为：20 文件（含 project.json）/50 根运行/200 操作，200 文件/1,000 根运行/3,000 操作，以及 20 文件/50 根运行/32 个独立大内容操作。大内容包含 1 MiB 文本、可真实解码的 4 MiB/20 MiB PNG（随机独立 RGBA 像素）、260 个轨迹节点和长回答。正文由实际当前存储适配器逐条保存，不共享同一字符串引用模拟存储；Git 可以共享不可变内容对象。每个样本五次，数据和原始结果只保存在 work/validation。

Web：Windows x64、i7-10700F、16 GiB RAM、Chrome 155.0.8059.41，Expo 生产 Web 导出。冷启动为新页面/JS/业务启动，未驱逐 OS/IDB 缓存；首屏等待初始可用界面/最新运行文字，后续详情按可见性读取。下表为中位/最大毫秒，JS 堆为 CDP 每 50ms 采样峰值，不能当作精确峰值或包含所有 ArrayBuffer/图片解码内存的总量。

| 样本   | 冷启动    | 首屏      | 冷刷新    | 温刷新  | 保存        | 保存 JS 堆峰值 |
| ------ | --------- | --------- | --------- | ------- | ----------- | -------------- |
| 普通   | 568 / 723 | 584 / 746 | 57 / 64   | 18 / 20 | 70 / 76     | 6.7 MiB        |
| 历史   | 590 / 674 | 620 / 725 | 294 / 309 | 76 / 82 | 320 / 380   | 10.3 MiB       |
| 大内容 | 576 / 639 | 620 / 669 | 163 / 179 | 18 / 23 | 928 / 1,004 | 80.4 MiB       |

三个样本首批均为 30 条摘要；首屏不读操作正文或 transcript。IDB/文件边界读写字节是逻辑传输量，不是物理磁盘 I/O：原始结果含各 store 命中计数、每阶段 readBytes/writeBytes。大内容温刷新不会复制历史大正文和项目图片字节；保存仍有必要全树读取/哈希。没有宣称整次保存或 Git 为 O(1)，也没有根据不同时段的运行推导固定收益比例。

Android：API 36.1 x86_64 只读隔离模拟器、SwiftShader、SDK 57 development build/Hermes、Metro 8082，同一主机。每阶段记录墙钟和 dumpsys meminfo 约 250ms 采样 PSS/native heap。计时包含 adb/uiautomator 观察；冷启动包含开发客户端/Metro，未清 OS 文件缓存。大内容刷新等待完整文件计数，普通/历史刷新等待首个文本条目，所以这不是严格一致的 UI 延迟对照；普通/历史样本在最后的 Git 对象复用改动之前采集，大内容为改动之后。只把它们作为实测成本与内存基线，不比较优化比例。

| 样本   | 冷启动中位/最大  | 刷新中位/最大    | 保存中位/最大      | 保存 PSS/native heap 采样峰值 |
| ------ | ---------------- | ---------------- | ------------------ | ----------------------------- |
| 普通   | 20.15 / 23.24 秒 | 6.04 / 6.31 秒   | 9.10 / 9.35 秒     | 520 / 295 MiB                 |
| 历史   | 22.46 / 24.29 秒 | 14.76 / 15.43 秒 | 20.93 / 23.16 秒   | 636 / 343 MiB                 |
| 大内容 | 28.67 / 31.23 秒 | 33.18 / 34.12 秒 | 124.10 / 130.48 秒 | 678 / 328 MiB                 |

大内容原生成本很高，并观察到换页压力。确认 isomorphic-git 在对象存在检查之前重新压缩内容后，checkpoint 改为计算实际 SHA、读取并校验已有 blob，内容一致才复用；损坏对象阻断快照并保留 HEAD，专项测试通过。此改动没有消除全树读取/哈希、对象解压和开发运行时成本。当前结果不足以通过发布前的真机性能验收；后续 Git/图片和轨迹渲染性能应另行设计，选择原生后端时用同样数据复测，不能用模拟器开发构建数值许诺真机收益。

复现：node scripts/architecture-measurement.mjs；AGENT_MOBILE_METRO_PORT=8082 时运行 node scripts/android-measurement.mjs emulator-5572。后者只允许指定的隔离设备，会替换该设备的测试 DB/工作区，保留 SecureStore；不可用于用户设备。--sample=large 可重测大内容并保留已记录的其他样本。每次重新测量注明源码和构建阶段。没有设置缺乏真机基线的产品耗时承诺；本轮硬验收是查询/写入范围、版本/权限检查、原子回执与数据正确性。

最终检查：npm run check 28 套/187 项通过；完整浏览器 44 条通过，最终 Git blob 复用变更后补跑 Git/提案/Skills 7 条通过；SQLite/真实 Chrome source adapter 故障测试通过；Web、Android/iOS JS/Hermes 导出通过；git diff --check 无错误。原生功能/故障专项见上节。没有提交或 PR，全部源码改动留在工作树。已停止本轮隔离模拟器、Metro、IPv4 代理和模拟服务器，保留用户 4180 预览服务与最新 Web 导出。
