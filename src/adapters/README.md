# 平台适配层

后续实现放在此目录。当前没有可用的文件、数据库、Git 或模型适配器。

- workspace：基于 expo-file-system 的受控路径访问；权限和版本检查位于宿主服务。
- database：expo-sqlite、迁移、任务日志、FTS 索引。
- git：调用本地 Expo 原生模块，封装 libgit2。
- model：流式请求解析、图片资源读取、供应商协议转换。
- credentials：expo-secure-store。

适配器实现 src/core 下的接口。core 不导入 React、Expo 或原生模块。
