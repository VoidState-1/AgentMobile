# 本地原生模块计划

当前没有 libgit2 二进制或桥接实现，不预建 modules 占位目录。真正实施时创建包含实际源码的 Expo 本地模块。

计划创建 modules/agent-git：

- Android：Expo Modules API（Kotlin）→ JNI/C++ → libgit2，NDK + CMake 构建。
- iOS：Expo Modules API（Swift）→ Objective-C++/C → libgit2，编译为静态库或 XCFramework。
- 固定相同的 libgit2 版本，并记录源码来源、构建选项和许可证。
- 原生侧根据 workspaceId 解析应用管理的目录，不接受任意绝对路径。
- Git 操作在后台线程执行；同一工作区的写操作必须串行。
- 首次只构建本地 Git 功能；不引入 TLS/SSH 远程传输依赖。

使用 Expo 的本地模块生成器创建真实模块后补充自动链接配置。不得放置返回伪造提交 ID 的占位实现。

生成的 android/ 和 ios/ 不提交；持久的原生源码保存在 modules，工程修改通过 config plugin 重建。
