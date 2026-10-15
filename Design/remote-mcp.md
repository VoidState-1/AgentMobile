# 远程 MCP 实施设计

日期：2026-10-14。状态：原型已接入；平台验证状态见 [validation.md](validation.md)。

## 架构与范围

手机是 MCP Host/Client，服务器部署在外部服务或用户自己的机器上。应用不安装 Node/Python 运行时，不启动手机上的 MCP 子进程。使用官方 `@modelcontextprotocol/client@2.3.1`，通过 Expo Fetch 连接完整 Streamable HTTP 端点，接受 JSON 与 SSE 响应。

SDK 显式启用版本自动协商：2026-07-28 使用 `server/discover` 和逐请求元数据；兼容旧服务时回退到 2025 的 initialize/initialized/session 流程。服务目录按 SDK 分页聚合，每次调用前刷新并核对已授权定义。首版实现 Tools；Resources/Prompts 浏览、OAuth、旧 HTTP+SSE 双端点传输、stdio 桥接、Tasks、MCP Apps、sampling、roots 与 elicitation 尚未实现。MCP 不要求用户在手机运行服务器。

## 配置与项目授权

“设置 → 远程 MCP”提供连接列表与编辑页：名称、完整端点、无需认证/Bearer Token、启停、请求超时、检测与工具发现、输入定义和项目工具开关。检测不执行工具。工具默认关闭，授权按项目保存，该项目内多个对话共享授权；演示模式不调用 MCP。

端点需要 HTTPS，localhost/127.0.0.1/IPv6 loopback 可用 HTTP。首版不开放远程明文 HTTP；Android 开发 fixture 通过 adb reverse 映射到 loopback。URL 中不得包含用户名密码、查询参数或片段，不自动补路径、跟随重定向或访问额外端点。暂不支持自定义 Header、客户端证书或 URL 查询鉴权；代理服务应提供 Bearer 或无需认证端点。浏览器预览需要服务允许 CORS；原生不受浏览器 CORS 限制。

配置储存在 SQLite `mcp-config/configuration` 的单条版本化图中（Web 为 IndexedDB），字段包括 schemaVersion/revision/servers/grants。grant 保存工具名及规范序列化定义指纹。名称、说明、schema 或只读声明变化后，重新发现会撤销不匹配授权；新增工具不自动授权。换端点、认证方式或 Token 会清空目录与授权。运行任务持有冻结的服务器/工具快照和凭证租约，编辑或删除连接不改变已运行任务；下一任务应用新配置。

Bearer Token 使用独立 `mcp-` 凭证引用写入 SecureStore，与模型凭证分开。Token 不进入配置图、任务快照、工具定义或调用轨迹；不会回显给模型。配置保存与 SecureStore 没有跨存储事务，`mcp-key-intents` 记录替换/清理意图，旧 Token 等配置提交及最后租约释放后清除，初始化重试未完成清理。Web Token 仅存内存，刷新后重新填写。

## Agent 与工作轨迹

任务启动获取当前项目已授权且启用的服务器租约。远程工具映射为唯一 `mcp_<服务器序号>_<工具序号>`，使用远端输入 schema 校验参数，纳入真实 Pi Agent 的串行工具循环。名称冲突不会覆盖本地工具；快照只包含授权工具。工具执行使用固定定义，阻止 SDK 的透明重发。

`TaskRecord.mcpSnapshot` 不包含 Token 或凭证引用。轨迹保存可读标签、输入、进度和结果，MCP 与本地文件操作按发生顺序交错显示。外部工具描述和结果不增加宿主权限；没有任意原生调用、工作区根目录或密钥读取接口。不会自动抓取结果内的 URL，也不会因返回 resource/link 就自动导入文件。模型可根据返回资料，继续通过现有受控工具保存到项目，形成真实 Git 提交并实时更新资料界面。

文本与内嵌文本资源返回模型，structuredContent 作为文本附加。只有模型开启图片输入时，经过格式/尺寸验证的 PNG/JPEG/WebP 才会转发；无效或不支持的内容显示说明，不改变已知远端完成事实。音频、视频和动态 UI 未实现。

## 执行回执与恢复

每次调用先在 `mcp-attempts` 保存 prepared：任务/轨迹 ID、服务器/工具、参数 SHA-256、隐藏凭证后的参数预览和时间。实际发送前必须成功保存 dispatched；日志失败阻止网络请求。确认结果后保存 completed 或 failed。

已发送后的断网、取消、超时、无效回执或结果保存失败保守标记 unknown；400/401/403/404 HTTP 拒绝和发送前失败可记为 failed/cancelled。进程中断时 prepared 收束为 cancelled，dispatched 收束为 unknown，相应运行轨迹显示“远端结果未知”，不会声称服务未执行。存储故障留下的 dispatched 也参与重复检查。

同一完整端点、工具和参数哈希存在未解除 unknown/dispatched 记录时，阻止再次发送；即使连接被删除后重建也不绕过。服务器编辑页和全局 MCP 列表提供待核对记录，删除连接后仍可查看旧记录。用户核对远端状态后手动解除重试限制；解除只写本地记录，不立即执行远端调用。首版不承诺远端 exactly-once：改变参数仍可能造成语义重复，远端幂等键、执行状态查询和业务撤销尚未实现。

## 容量与后续

每台服务器最多发现 64 个工具，单项目最多启用 32 个工具，SDK 最多聚合 5 页。输入/输出定义各最多 24,000 字符、递归最多 16 层，引用 schema 和特殊属性暂不支持，UI 标为不可启用。请求体最多 512 KB、单响应最多 2 MB，单项文本转发最多 100,000 字符，超过后明确标注截断，进度说明最多 1,000 字符；请求超时 5–600 秒、默认 120 秒，任务仍受全局 Agent 预算控制。

后续按实际服务需求加入 OAuth 授权与安全回调、更多 schema 能力、按风险逐次确认、资源/Prompt 的显式导入、Tasks/可恢复长调用、远端幂等约定与 MCP Apps。手机后台常驻、手机内运行服务器和任意远程代码执行不在当前实现范围。

参考：[MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)、[生命周期](https://modelcontextprotocol.io/specification/latest/basic/lifecycle)、[TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)。
