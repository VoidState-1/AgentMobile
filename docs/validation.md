# 验证记录

最近更新：2026-10-13。下方保留初始化结果，原型结果见新增章节。

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
