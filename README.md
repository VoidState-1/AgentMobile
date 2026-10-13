# Agent Mobile

手机端本地 Agent harness 原型：文字和图片保存在本地工作区，Pi Agent Core 通过受控工具执行任务，Git 保存每一步文件修改。

## 当前可体验

- 创建项目，导入 Markdown、文本和 PNG/JPEG/WebP 图片。
- 编辑、移动、删除文字与图片，预览图片，导出单文件。
- 通过 Pi Agent Core 1.1.0 运行任务，查看工具进度和结果。
- 默认演示模式无需密钥；可配置 Chat Completions 兼容模型服务。
- 查看真实 Git 提交、任务文件变化，撤销最新任务或恢复历史。
- 文件操作日志、版本冲突检测、工作区写锁和启动恢复。

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

需要 Android Studio、SDK、兼容的 JDK、NDK 和 CMake。首次编译后，仅修改 TypeScript 可运行 npm start；新增原生依赖后重新编译。当前新增了 expo-crypto，旧开发客户端需要重建。

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

## 模块

```text
src/core/             平台无关类型、路径规则、存储接口
src/adapters/agent/   Pi 适配、工具定义、任务执行器、演示传输
src/adapters/model/   兼容服务的 SSE 流式传输
src/adapters/storage/ SQLite/私有文件与 Web IndexedDB 适配
src/adapters/git/     真实 Git 和自定义 fs 适配
src/adapters/workspace/ 文件权限、修订、操作日志与恢复
src/features/prototype/ 项目、资料、Agent、历史与模型设置界面
modules/             libgit2 原生模块预留
tests/               核心一致性与浏览器流程测试
```

android/、ios/ 由 Expo Prebuild 生成，不提交。持久原生修改放在 modules/config plugin。应用标识暂用 com.agentmobile.app，上架前替换。图标暂用 Expo 模板素材。

不把密钥放入源码、EXPO_PUBLIC_*、Git、日志或网页资源。统一模型额度需要后端保管开发者密钥，当前采用用户自带 Key。
