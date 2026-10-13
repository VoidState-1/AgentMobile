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
