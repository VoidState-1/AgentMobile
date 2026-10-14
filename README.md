# Agent Mobile

手机端本地 Agent harness 原型：文字和图片保存在本地工作区，Pi Agent Core 通过受控工具执行任务，Git 管理明确提交，内部检查点负责修改恢复。

## 当前可体验

- 创建项目，导入 Markdown、文本和 PNG/JPEG/WebP 图片。
- 编辑、移动、删除文字与图片，预览图片，导出单文件。
- 通过 Pi Agent Core 1.1.0 运行任务，查看工具进度和结果。
- 默认演示模式无需密钥；支持 Chat Completions、Anthropic Messages、Gemini 原生协议。
- 多连接与独立密钥、模型发现/手工配置、收藏、参数、分层默认和文本/工具/图片检测。
- 任务启动时冻结模型配置；进入配置页面、修改密钥或参数不影响当前任务。DeepSeek 前版已实测，Anthropic/Gemini 本轮采用模拟验证。
- 保存与提交分离；查看未暂存/已暂存差异，按文件暂存、取消暂存和明确提交；任务变化预览、冲突检测撤销和历史恢复。
- 文件操作日志、版本冲突检测、工作区写锁和启动恢复。
- 紧凑工作台、跟随系统或手动切换深浅主题、固定会话输入区。
- 独立编辑器、Markdown 阅读、未保存保护、逐行差异和恢复预览。
- 项目下多个独立对话，分别保存消息、草稿、附件引用与模型选择，支持归档/恢复；共享项目资料和 Git 历史。

演示使用预设步骤，不进行语义理解。真实模型模式需要用户配置服务、模型和 API Key。

移动端使用 Expo FileSystem + SQLite + SecureStore；浏览器预览使用 IndexedDB，密钥仅保留在页面会话内。原型 Git 后端为 isomorphic-git，使用标准 Git 格式；libgit2 原生桥接尚未实现。

使用说明：[docs/prototype.md](docs/prototype.md)。技术设计：[docs/design.md](docs/design.md)。验证与限制：[docs/validation.md](docs/validation.md)。

## 开发

Node.js 满足 Expo SDK 57 的要求，当前开发环境为 24.11.0；使用 npm 和 package-lock.json。

```sh
npm ci
npm run web
```

Android Development Build：

```sh
npm run android
```

需要 Android Studio、SDK、兼容的 JDK、NDK 和 CMake。首次编译后，仅修改 TypeScript 可运行 npm start；新增原生依赖后重新编译。本次增加 react-native-svg 和开发菜单配置，旧开发客户端需要重建。

iOS 在 macOS/Xcode 上运行 npm run ios，或配置云构建。

浏览器静态预览：

```sh
npm run build:web
npm run preview
```

预览地址为 http://127.0.0.1:4180。Web 使用单页模式，适合本地存储驱动的交互应用。

## 验证

```sh
npm run check
npx expo-doctor
npx expo export --platform all --output-dir work/prototype-export
npm run test:e2e
```

check 包含 TypeScript、ESLint 和 Vitest。端到端测试需要本机 Chrome 和已导出的 Web 目录；Playwright 自动启动预览服务。测试产物在 work/，不提交。

浏览器测试不能替代 Android/iOS 原生测试，尤其是权限、安全存储、后台行为、掉电持久化和 Hermes 运行。

已验证 Android API 36.1 x86_64 模拟器：创建工作区、Pi 任务、Git 写入与强制关闭后的持久化。可用 npm run test:android -- <serial> 重跑操作检查；需要已启动的开发客户端、Metro、ANDROID_HOME 和 adb reverse tcp:8081 tcp:8081。初次开发菜单提示需要关闭。arm64 真机和 iOS 仍需验证。

真实服务回归通过环境变量 DEEPSEEK_API_KEY 提供密钥，运行 npm run test:live；Android 运行 npm run test:android:live -- <serial>。这些检查会实际调用模型并产生费用，普通 check/test:e2e 不使用真实密钥。Metro 使用其他端口时设置 AGENT_MOBILE_METRO_PORT 并配置对应 adb reverse。原生操作期间应保持界面源码稳定；ADB 在 Modal 内模拟硬件输入时，连续 R 可能触发调试包的“RR”重载，测试文字需避开这个快捷键。

配置器原生模拟验证：在一个终端运行 npm run test:mock-model，再在已连接开发客户端的模拟器上运行 npm run test:android:config -- <serial>。脚本使用 adb reverse 连接本机 4181 的三协议模拟服务，不调用付费供应商。测试会创建本地测试项目与连接；使用独立模拟器。Mock 脚本使用 Node.js 的 TypeScript 类型剥离，当前验证环境为 Node 24。

多对话原生验证：`node scripts/android-conversations.mjs <serial>`，检查 A/B 消息、草稿、附件隔离、强制停止恢复、归档恢复与主题。使用演示传输，不调用真实模型。

Git 工作流：[docs/git-workflow.md](docs/git-workflow.md)。原生验证运行 `node scripts/android-git.mjs <serial>`，检查真实 index、提交、未提交内容、重启与回执恢复；会对合成测试数据库注入中断，仅在隔离模拟器使用。

## 模块

```text
src/core/             平台无关类型、路径规则、存储接口
src/adapters/agent/   Pi 适配、工具定义、任务执行器、演示传输
src/adapters/model/   三协议 REST/SSE、模型目录与诊断
src/adapters/storage/ SQLite/私有文件与 Web IndexedDB 适配
src/adapters/git/     真实 Git 和自定义 fs 适配
src/adapters/workspace/ 文件权限、修订、操作日志与恢复
src/features/workbench/ 主题、会话、文件、编辑器、版本与设置
plugins/             可重建的原生配置，包括不遮挡界面的开发菜单
modules/             libgit2 原生模块预留
tests/               核心一致性与浏览器流程测试
```

android/、ios/ 由 Expo Prebuild 生成，不提交。持久原生修改放在 modules/config plugin。应用标识暂用 com.agentmobile.app，上架前替换。图标暂用 Expo 模板素材。

不把密钥放入源码、EXPO_PUBLIC_*、Git、日志或网页资源。统一模型额度需要后端保管开发者密钥，当前采用用户自带 Key。
