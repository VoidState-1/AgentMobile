# Agent Mobile

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                           |
| -------- | ------------------------- | ---------------------------------------- | -------------------------------------------------- |
| 1.0.0    | 2026-10-15T17:24:30+08:00 | 9ad009be8a41df28a02060c5620ee12a29c3d901 | 重建项目入口，链接稳定技术文档与独立历史设计目录。 |

手机端本地 Agent harness：文字和图片保存在本地工作区，Pi Agent Core 经受控工具执行任务，标准 Git 管理明确提交，内部检查点与业务回执负责中断恢复。

当前采用 React Native、Expo Development Build、TypeScript。原生使用 FileSystem + SQLite + SecureStore，Web 使用 IndexedDB，密钥只留在当前页面内存。真实模式连接用户提供的远程模型；默认演示模式执行预设步骤，无需 Key。

## 当前能力

- 项目下多个独立对话，分别保存草稿、历史和模型选择，共享项目文件与 Git。
- Markdown/文本与 PNG/JPEG/WebP 导入、编辑/管理、预览和单文件导出。
- Chat Completions、Anthropic Messages、Gemini 原生协议，独立连接/凭证、模型目录、参数与诊断。
- 内联执行轨迹、服务返回的公开推理/摘要、文件操作后的实时刷新。
- 跨项目并发、一层 reader/reviewer/writer 子 Agent、共享预算与隔离提案。
- 远程 MCP 工具发现及项目授权，未知结果核对与重试屏障。
- Agent Skills 导入、资源、版本冻结、项目授权与按需加载。
- 显式暂存/提交、工作区差异、任务撤销、历史恢复和启动回执恢复。

当前未对外发布，允许破坏性接口/存储更新，不维护旧原型兼容层。isomorphic-git 为当前 Git 后端；libgit2、自定义原生桥接、持续后台执行、IntelligentUI、网页沙箱和多层委派尚未实现。平台验收与性能边界见技术文档。

## 快速开发

使用 npm 与锁文件，Node 满足 Expo SDK 57；当前脚本验证环境为 Node 24.11.0。

```sh
npm ci
npm run web
```

Android Development Build 使用 `npm run android`，之后仅 JS/TS 修改可用 `npm start`。iOS 本地编译在 macOS/Xcode 上使用 `npm run ios`。

静态 Web 预览：

```sh
npm run build:web
npm run preview
```

地址为 `http://127.0.0.1:4180`。检查运行 `npm run check`；Web 流程回归先导出再运行 `npm run test:e2e`。完整平台、模拟服务和故障验证流程见 [开发环境](docs/development.md) 与 [测试与维护](docs/testing-and-operations.md)。

## 技术文档

[docs/README.md](docs/README.md) 是完整文档导航与更新规范。建议先读 [系统设计](docs/design.md)，再读 [应用接口](docs/application-api.md) 和负责的子系统。

- [存储与恢复](docs/storage-and-recovery.md)、[工作区与 Git](docs/workspace-and-git.md)。
- [Agent 执行与子任务](docs/agent-runtime.md)、[对话与轨迹](docs/conversations-and-trace.md)。
- [模型协议](docs/model-providers.md)、[远程 MCP](docs/remote-mcp.md)、[Agent Skills](docs/agent-skills.md)。
- [前端工作台](docs/frontend.md)、[开发环境](docs/development.md)、[测试与维护](docs/testing-and-operations.md)。

开发约束见 [AGENTS.md](AGENTS.md)。旧设想、审计、改进计划与阶段验收记录在 [Design](Design/)，作为历史资料保留，当前实现以源码和稳定技术文档为准。

## 数据与原生约定

不提交凭证、私有资料、临时导出或生成的 android/ios。永久原生配置通过 config plugin；实际原生源码需要时放 modules，当前不预建占位目录。

不把 Key 放到源码、日志、网页资源或 EXPO_PUBLIC 环境变量。常规测试使用模拟；`test:live` 和 `test:android:live` 明确配置 DEEPSEEK_API_KEY 后才运行真实请求，可能产生费用。Web 检查不能代替 Android/iOS 原生持久化、权限与进程恢复验收。
