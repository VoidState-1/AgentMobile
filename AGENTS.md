# Agent Mobile 开发约定

- 文档默认使用中文；代码标识符使用英文。
- 技术栈为 React Native、Expo Development Build、TypeScript；依赖版本以 package-lock.json 为准。
- 当前未对外发布，开发期以代码整洁、效率和当前需求为优先，允许内部接口与存储格式的破坏性更新，不承诺前向或向后兼容。
- 不为旧原型保留兼容别名、重导出、双写、Legacy DTO、历史格式读取或升级/降级迁移链；替换实现时同步更新调用者、测试和文档，并删除旧路径。开发实例和测试数据可按当前格式重建，不为保留旧数据增加常驻兼容层。
- 格式标识用于校验当前格式与提示开发数据重建，不用于维护历史版本分支。当前格式的事务、幂等、权限与进程中断恢复仍是必要功能；外部模型/MCP 协议支持按实际需求保留。
- 不以未来可能使用为由预建空目录、占位抽象或平行实现。破坏性更新与格式重建只作用于本项目明确的开发/测试范围，不顺手清理凭证、项目外文件或外部服务数据。
- 如有生图需求，请优先使用 niko_image 生图 MCP。
- src/core 仅包含平台无关的领域逻辑和接口，不导入 React、Expo、Node.js 或原生库。
- 平台实现放在 src/adapters；路由放在 src/app，业务界面后续放在 src/features。
- src/application 编排平台无关用例；src/bootstrap 组装依赖。界面通过 AppServices 调用业务，禁止直接引用 adapters、数据库、Git 或凭证存储；分层限制由 ESLint 验证。
- Agent 和动态 UI 通过受控工作区接口操作文件。禁止直接暴露绝对路径、.git、数据库、密钥和任意原生调用。
- Git 是项目文件历史的来源；SQLite 是任务、会话和业务元数据的来源；Zustand 仅保存界面状态。
- 文件修改必须考虑基础版本、操作日志、重试和进程中断。Git 与 SQLite 不具有跨存储事务。
- 原生源码放在 modules，通过 Expo Modules/config plugin 集成。不要把修改只留在会被 prebuild 重建的 android/、ios/ 中。
- 不提交凭证、私有资料、临时导出和生成的原生构建目录。
- 修改后运行 npm run check；依赖或 Expo 配置变化后运行 npx expo-doctor。影响原生桥接、持久化或恢复逻辑时增加相应验证。
- 设计范围和实施状态记录在 docs/design.md；尚未实现的能力必须明确标注。
