# 开发环境、构建与依赖维护

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                                           |
| -------- | ------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| 2.1.0    | 2026-10-21T19:36:27+08:00 | 9a6b3c38be2c3f7cc35e064b684038040b9f63e8 | 同步尚未提交配置：精简 Android 权限、关闭默认备份并区分 Debug/Release 清单验证。   |
| 2.0.0    | 2026-10-19T17:56:09+08:00 | 414863fdcd788534b2232fea740024864a8726a4 | 对应已提交源码：产品原生模块、HTTPS 互操作、合并/变基 UI 验证和实例重建要求。      |
| 1.2.0    | 2026-10-18T20:30:20+08:00 | 262940983352666ec86b8389fc656ed368f5680d | 同步尚未提交源码：增加 libgit2 源码准备、Android 测试与 iOS XCFramework 构建入口。 |
| 1.1.0    | 2026-10-18T19:00:33+08:00 | 34f542b6f4e917f475d36c9f5ea8b369f5d74dda | 同步尚未提交源码：记录离线编辑器构建、WebView 原生依赖和许可证生成。               |
| 1.0.0    | 2026-10-15T17:24:30+08:00 | 9ad009be8a41df28a02060c5620ee12a29c3d901 | 整理安装、各平台启动、Metro 适配、构建和原生维护流程。                             |

## 1. 环境要求

使用 npm 与 [package-lock.json](../package-lock.json)，首次检出执行 `npm ci`，不混用其他包管理器生成第二套锁文件。Node 需满足 Expo SDK 57 及锁定依赖的 engines；当前脚本验证环境使用 Node 24.11.0。若使用其他版本，先确认 `.ts` 类型剥离与 `node:sqlite` 支持，一些模拟/测量脚本依赖这两项。

Android 需要 Android Studio、Android SDK、JDK 和构建依赖；具体 Gradle/NDK/CMake 版本由当前 Expo/RN 生成工程决定。脚本使用 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT` 找到 adb，优先设置前者。iOS 本地编译需要 macOS 与 Xcode；Windows 上不能用 `npm run ios` 完成原生验收。

Web E2E 配置使用 Playwright 的本机 `chrome` channel，需安装 Chrome。测试、缓存和导出产物写到被忽略的 `work/`。

## 2. 快速启动

```sh
npm ci
npm run web
```

浏览器开发模式使用 IndexedDB，密钥在当前页面内存。相同 origin 共享业务实例；`localhost` 与 `127.0.0.1` 或不同端口是不同 origin，不能据此判断数据丢失。

静态导出与预览：

```sh
npm run build:web
npm run preview
```

`build:web` 导出到 `work/prototype-export`，preview 固定监听 `http://127.0.0.1:4180`。它提供单页路由回退和 `no-store` 响应。每次源码变化后需要重新 export，刷新旧导出目录不会加载新的 TypeScript。

## 2.1 离线文档资源

`npm run build:editor` 使用 esbuild 将 CodeMirror、Markdown-it、样式及完整第三方许可打入离线 HTML，生成被 Git 忽略的 `src/features/document/generated.ts`。源码位于 `src/features/document/browser` 和共享 render/markdown.css；许可清单为 `licenses/document-editor.txt`。安装与 start/android/ios/web/build:web/typecheck/test 的 npm 入口会构建资源，不依赖 CDN 或原型 work 目录。直接调用 Expo CLI 前先执行 build:editor。

新增的 react-native-webview 必须重新构建 Development Build；不能只用 Metro 热更新旧安装包。不要把生成的 android/ios 目录加入 Git。

## 3. Android Development Build

Android 配置显式阻止相机、录音、广泛外部存储读写和悬浮窗权限，并将 `allowBackup` 设为 false。导入通过系统文档选择器取得用户选中文件的临时 URI 授权，导出通过系统分享授予所选接收方访问副本，不需要全盘存储权限。网络、库依赖的普通权限和开发客户端权限需检查合并后的 Debug/Release Manifest；不要把生成工程或旧 APK 的权限当作当前配置。开发包仍可调试，不作为发布安全配置的证明；厂商设备迁移行为仍需真机验证。

Expo 的 Debug 变体清单优先级高于主清单，单独配置 blockedPermissions 仍可能恢复悬浮窗权限。[权限插件](../plugins/with-android-permissions.js) 将同一阻止列表应用到 debug/debugOptimized 清单，修改可经 prebuild 重建，仍需以最终合并结果验收。

首次构建/安装：

```sh
npm run android
```

以后只修改 JS/TS：

```sh
npm start
```

设备需要已安装与当前原生依赖匹配的 Development Build。React Native 热更新不会增加原生模块；依赖、config plugin 或原生配置变化后重新执行原生构建。当前应用依赖多个 Expo 模块，按 Development Build 维护和验收，不把 Expo Go 作为原生能力标准。

USB/模拟器运行时可映射 Metro 端口：

```sh
adb -s <serial> reverse tcp:8081 tcp:8081
```

Metro 使用其他端口时，设置测试脚本的 `AGENT_MOBILE_METRO_PORT`，并映射同一端口。模型/MCP 模拟服务另用 4181，原生模拟脚本会配置该端口反向映射。应用内 HTTP 地址限制仍是 localhost/loopback，不要通过修改 URL 校验来临时开放任意明文服务。

初次开发菜单弹窗需关闭后再运行 UI 脚本。开发包中 adb 发送连续硬件 `R` 键可能触发 RN 的 RR 重载；现有脚本会避开部分输入模式。测试期间保持源码稳定，避免 Fast Refresh 改变观察结果。

## 4. iOS 与多平台导出

macOS 本地构建：

```sh
npm run ios
```

跨平台 JS 打包检查可执行：

```sh
npx expo export --platform all --output-dir work/prototype-export
```

Web、Android 或 iOS 的 bundle 导出，只证明当前打包链能处理源码和依赖。它不证明原生编译、设备权限、SecureStore 行为或实际 Hermes 运行通过。仓库目前没有稳定的 iOS 真机验收证据，也没有可直接宣称已配置的云构建发布流水线。

## 5. Metro 的移动端依赖边界

[metro.config.js](../metro.config.js) 有四项关键解析：

| 依赖入口                              | 当前替换                         | 原因                                                      |
| ------------------------------------- | -------------------------------- | --------------------------------------------------------- |
| `@earendil-works/pi-ai`               | `adapters/agent/pi-ai-mobile.ts` | 仅公开纯工具；避免 Node auth、供应商 SDK 与目录进入移动包 |
| `@modelcontextprotocol/client/_shims` | SDK `shimsBrowser.mjs`           | Hermes/Web 使用解释执行 schema 校验路径                   |
| `pkce-challenge`                      | 浏览器入口                       | Hermes 不使用 Node 条件入口；不表示已实现 OAuth           |
| `isomorphic-git`                      | 官方 browser UMD bundle          | 避免 Node stream/crypto 依赖链                            |

业务层禁止引用 Pi/MCP SDK 类型。增加上游导出时核对公共入口与目标平台的可打包性，不通过复制第三方源码或全局 Node polyfill 解决全部问题。Vitest 与 Metro 的解析环境不同，单元测试通过后仍需导出/原生验证。

原生 Git 正式桥接需要重新构建 Development Build；仅更新 Metro 不会更新 C++/Kotlin/Objective-C++。`node scripts/android-native-git-remote.mjs <serial>` 使用本机标准 Git、临时 TLS 证书与独立测试 APK 验证认证/推送/克隆及响应丢失。证书只注入测试进程信任库，不改变产品证书策略，fixture 和测试私钥仅位于忽略的 work 目录并在结束时清理。`node scripts/android-native-git-ui.mjs <serial>` 通过实际界面验证分支、身份和标签；使用已有的 AGENT_MOBILE_METRO_PORT 配置，要求安装当前 Development Build。

合并与变基 UI 验证复用开发专用 fixture 入口，先运行真实应用的两进程验证，再驱动真实路由与界面；端口配置、运行顺序和 fixture 重建要求见 [原生 Git 验证入口](native-git.md#4-构建与验证入口)。验证期间避免编辑入口源码，以免 Metro 的热更新改变正在运行的路由上下文。

## 6. Expo 配置与原生源码

[app.json](../app.json) 使用 `expo-router/entry`，应用 scheme 为 `agentmobile`，Android package 和 iOS bundle identifier 当前均为 `com.agentmobile.app`，Web `output` 为 `single`，系统深浅色自动适配。

配置插件包括 Router、dev-client、SQLite、SecureStore、Splash、Sharing 与 [with-dev-menu](../plugins/with-dev-menu.js)。SQLite 配置启用 FTS 构建选项，但当前 `search_text` 是受控逐文件搜索，没有 SQLite FTS 索引查询实现。

`android/`、`ios/` 为 Expo Prebuild 生成目录，已经忽略，不作为源码归档。永久原生配置写入 app config/plugin；自定义原生能力实现于 `modules/` 的 Expo Module，通过自动链接或 plugin 集成。当前有已接入产品的 [libgit2 原生模块](native-git.md)，移动端使用原生 GitPort。`npm run android` 会准备经过校验的 Git 源码；直接调用 Gradle 前运行 `npm run prepare:git`。iOS 构建入口会先构建 XCFramework，需在 macOS 安装 CMake；不把下载源码和编译产物加入 Git。

不要把手工修改仅留在生成工程，下一次 prebuild 会使其丢失。依赖或 Expo 配置变更后运行 `npx expo-doctor` 并重新构建受影响 Development Build。

## 7. 日常检查与提交前工作

```sh
npm run check
npx prettier --check docs README.md
```

`check` 依次运行 TypeScript、ESLint、Vitest。`format:check` 检查整个仓库格式；批量格式化仅适用于明确的格式整理任务，普通变更对本轮文件运行 `npx prettier --write <文件>`，减少无关 diff。

影响接口时更新 [application-api](application-api.md)；影响持久化时更新 [storage-and-recovery](storage-and-recovery.md) 并做相应恢复验证；影响能力范围时更新 [design](design.md)。测试选择见 [测试与维护](testing-and-operations.md)。

## 8. 开发数据和凭证

当前未发布，不维护旧 schema 兼容读取或迁移链。格式不匹配时由应用引导明确重建开发实例；具体删除范围、启动前置条件和中断恢复见存储文档。格式重建不应变成通用“故障时清空数据”的按钮。

凭证不要写入源码、文档、Git、日志、网页资源或 `EXPO_PUBLIC_*`。原生保存在 SecureStore，Web 保存在页面内存。真实模型回归使用 `DEEPSEEK_API_KEY` 环境变量，会产生费用；常规单元/E2E 使用模拟，不需要真实 Key。

## 9. 新能力开发路径

先在 core 定义明确的数据契约和授权规则；application 编排用例、意图和恢复；adapters 实现平台或协议；bootstrap 组装并通过显式 AppServices 暴露最小界面能力；features 增加 UI。只有真正涉及原生桥接时才创建 Module。

变更内部契约时同步删除旧路径、替换测试/文档，不保留过渡重导出或历史 DTO。外部协议兼容属于实际产品功能，不能以“开发期不兼容”为理由删除已支持的供应商/MCP 协议。
