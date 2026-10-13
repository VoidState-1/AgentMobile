# 平台适配层

- agent：Pi Agent Core 1.1.0；TypeBox 工具参数校验、串行执行、宿主任务记录和预算。
- model：Chat Completions 兼容 SSE 传输，作为 streamFn 注入。没有加载 Node 供应商 SDK。
- storage/platform：移动端 Expo 私有文件、SQLite 和 SecureStore。
- storage/platform.web：浏览器 IndexedDB，密钥仅保留在页面会话中。
- git：isomorphic-git 真实仓库格式及 host filesystem 适配。
- workspace：受控路径、版本检测、写锁、操作日志、恢复和历史还原。
- io：系统导入/分享与浏览器文件导入/下载。

Git/SQLite 不具有共同事务。workspace/service.ts 在文件应用前持久化操作，Git 提交携带 operationId，启动时完成未记录的操作。恢复失败的项目禁止继续写入。

Pi 根入口在 Metro 中被映射到 agent/pi-ai-mobile.ts，仅导出上游纯工具函数；没有 fork Agent Core。升级 Pi 后要重新运行类型检查、工具循环测试和两端打包。

当前原生适配已通过 Android API 36.1 x86_64 模拟器操作验证，arm64 真机/iOS 尚未验证；libgit2 原生模块仍待实现。
