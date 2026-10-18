# Markdown 编辑器接入与验收记录

| 版本  | 更新时间                  | Git 代码基线                             | 说明                                   |
| ----- | ------------------------- | ---------------------------------------- | -------------------------------------- |
| 1.0.0 | 2026-10-18T18:53:46+08:00 | 34f542b6f4e917f475d36c9f5ea8b369f5d74dda | 本次未提交工作区的实现与实际验证记录。 |

## 交付核对

| 用户要求                   | 当前实现及证据                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 在软件接入已确认的原型     | 工作台 editor.tsx 使用 DocumentHost；离线 CodeMirror 单文档承载分块/全文模式，手机 WebView 与 Web iframe 共用内核。                                                           |
| 保留手势及连续编辑体验     | 左滑进入、右滑保存、左滑放弃；多个相邻区域共享光标、选区和退格；跨区修改关联保存/放弃。灰底全宽、正文对齐、无外边距/圆角，纵向保留 8px。                                      |
| 替换旧模块、不保留旧路径   | 删除 src/features/workbench/markdown.tsx；工作台不再使用正文 TextInput。文件和对话均使用 Markdown-it，没有旧解析器、重导出别名或独立原型运行分支。                            |
| 接入实际文件与恢复         | AppServices 保留项目/相对路径/基础版本校验，稳定 operationId 与原日志幂等；编辑草稿经业务库保存，写前记录保存意图，读回实际字节确认后才推进基线。EOL 字节变化也视为外部冲突。 |
| 修复原型边界与原生接入问题 | 可见源码与连接换行分离；首尾/预览禁止光标落点；共享行仅移动目标文字；按块锚定滚动；修正 Android 隐式指针捕获转移的取消问题，键盘避让后工具栏可见。                            |
| 模式切换及空文件完整性     | 未保存时明确保存、放弃或继续编辑；模式/区域一次更新，避免无效中间快照。空文件即使已切到阅读模式也可实际创建及零字节导出。                                                     |
| 资源与构建完整             | 源码与样式位于 src/features/document；npm 安装/启动/检查入口构建离线资源，完整许可位于 licenses/document-editor.txt。没有 CDN、任意原生访问或远程图片自动加载。               |

## 本次实际验证

- npm run check：TypeScript、ESLint、37 个 Vitest 文件通过，共 260 项测试。
- npx playwright test --workers=3：全量 68 项通过，包含真实触摸指针、共享行拖动、跨块退格/保存、模式选择、零字节文件、草稿恢复，以及原有 Git/会话/模型/MCP/Skills/实时刷新回归。
- npx expo-doctor：21/21 通过；一次远端网络重置后重试通过，没有修改检查规则规避检查。
- npm run build:web：通过。
- npx expo export --platform all --output-dir work/document-editor-export：Android/iOS Hermes 与 Web 导出通过。
- npx expo run:android --no-bundler --device Medium_Phone_API_36.1：原生 Development Build 构建并安装通过。
- Android emulator-5554 / API 36.1：编辑专项及分段恢复验证完成，覆盖真实键盘、模式/离开确认、force-stop 后草稿恢复、实际保存重开、真实左滑与方向键、空文件创建。
- node scripts/android-smoke.mjs emulator-5554：完整冒烟通过，覆盖主题、原生编辑保护、Pi 工具、Git 文件写入与进程重启持久化；使用本地 mock-model-server，没有使用付费供应商。
- 原生对话阅读器额外核对：实际 WebView 的 kind=reader，内容“测试模型已整理资料并保存文件。”，内容高度 25px；确认并非空白占位。
- Prettier 与 git diff --check 通过。旧 Markdown 路径不存在，src 不依赖 work 下的原型资源。

## 范围与使用

iOS 已通过 JavaScript/Hermes 导出，未在 iOS 设备或 Xcode 上运行。Android 验证使用 x86_64 模拟器，不等同于所有真机/输入法验收。新依赖 react-native-webview 需要重建旧 Development Build。文件与草稿分别提交事务；强杀前尚未送达宿主或尚未落库的最后输入仍可能丢失。草稿通过重新打开对应文件恢复，不提供协同编辑或外部修改的自动合并。

实现和稳定契约见 docs/frontend.md、docs/application-api.md、docs/storage-and-recovery.md、docs/development.md。未创建提交或 PR。
