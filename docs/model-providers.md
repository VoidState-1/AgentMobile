# 模型供应商、配置与原生协议

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                      |
| -------- | ------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| 1.0.0    | 2026-10-15T17:24:30+08:00 | 9ad009be8a41df28a02060c5620ee12a29c3d901 | 整理连接/模型配置、凭证租约、三协议编码解码、公开推理及诊断。 |

## 1. 连接与模型分离

ProviderConnection 表示一个服务连接：presetId、protocol、baseUrl、auth、compatibility、apiVersion、enabled、revision 及诊断记录。ModelEntry 属于连接，保存 apiId、显示名、enabled/favorite、能力证据、参数、目录状态、限制与独立 revision。

UI 显示名与请求模型 ID 不同；不通过名字包含某个词自动判断协议或推理能力。预设为 deepseek/anthropic/gemini/custom，实际协议为 chat-completions/anthropic-messages/gemini。DeepSeek compatibility 是明确选项，不从 host 或 modelId 暗中猜测。

配置 schemaVersion=1，整个 ModelConfiguration graph 保存到 `model-config/configuration`，服务串行修改、保存成功后发布冻结快照。

## 2. 选择优先级与失效行为

模型默认优先级：会话 sessions → 项目 projects → global。mode 可全局设置，也可由 sessionModes 覆盖。当前 sessionId 对应业务 conversationId。

删除连接会删除其模型条目；删除模型/连接保留失效的显式 pin。这样后续运行会要求重新选择，不会静默跳到另一个供应商。清除某层 pin 是用户明确恢复继承的动作。

运行检查连接/模型启用、能力与参数。Agent 使用模型若明确不支持 tools，则拒绝启动；unknown 不是已验证，也不会被模型目录“看见该名字”直接提升为 supported。图片开关 allowImages 与 images 能力证据独立，明确 unsupported 时不能启用。

## 3. 地址与认证

| 协议               | 默认基础地址                                           | 生成后缀                                    | 认证                                         |
| ------------------ | ------------------------------------------------------ | ------------------------------------------- | -------------------------------------------- |
| Chat Completions   | DeepSeek：`https://api.deepseek.com`；自定义由用户填写 | `/chat/completions`                         | `Authorization: Bearer ...` 或配置 auth=none |
| Anthropic Messages | `https://api.anthropic.com/v1`                         | `/messages`                                 | x-api-key + anthropic-version                |
| Gemini             | `https://generativelanguage.googleapis.com/v1beta`     | `/<模型资源>:streamGenerateContent?alt=sse` | x-goog-api-key                               |

baseUrl 应包含服务需要的版本前缀，不能把完整生成端点当作基础地址。地址要求 HTTPS，仅 localhost/127.0.0.1/[::1] 允许 HTTP；禁止内嵌 userinfo、查询参数或 hash。Gemini model resource 由 model-id 规则验证处理，避免 apiId 拼接越界路径。

Anthropic Web 请求加 SDK 所需的直接浏览器访问 header，但供应商/网关仍须允许 CORS。原生可联网不表示浏览器可以；Key、协议、CORS 和网络故障需分别诊断。

## 4. 密钥与运行租约

秘密值保存在 CredentialStore，配置只存 credentialRef。运行持久化 ModelRunSnapshot 明确排除 ref 和秘密值，包含连接/模型 revision、协议、地址、参数和 contextTokens；宿主 ModelRunLease 在内存提供 secret。

替换 Key 先写 KeyOperation，再保存新 credential，更新配置，最后退役旧 ref。配置仍引用或有活跃租约时不能删旧 Key；release 幂等并触发清理。复制连接不复制 Key；改变地址 origin 或 auth 时取消原绑定，需重新配置。

原生 SecureStore 跨重启存在；Web Map 随页面结束消失，恢复后 keyReady=false 是预期。普通 UI 和任务记录不能读取 secret，也不能把它放进 EXPO_PUBLIC 环境变量。凭证与数据库无跨存储事务，意图清理失败在启动/租约释放后重试。

## 5. 能力证据与目录

每项 tools/images/reasoning 用 supported/unsupported/unknown 和 preset/discovery/user/verified 来源记录，不仅是一个布尔开关。

DeepSeek 预设只对源码列出的精确 apiId 给出已知声明；当前 deepseek-flash、deepseek-v4-pro 的证据规则见 [presets.ts](../src/core/models/presets.ts)。这些声明并非所有服务网关和参数组合的真测结果。

发现接口均为 `/models`，最多 20 页、5,000 个模型，单响应最多 2 MiB。Anthropic 用 after_id，Gemini 用 pageToken 并筛掉没有 generateContent 方法的条目；Chat 通用目录没有统一能力字段。目录提供的上下文/输出限制可用于校验，发现缺失不自动删除用户模型。

目录不可用仍可手工添加模型。身份或关键配置/参数改变时旧检测结果不再覆盖新配置；迟到目录/诊断通过 fingerprint/revision 检查拒绝写回。

## 6. 参数契约

| 参数              | 规则                                        |
| ----------------- | ------------------------------------------- |
| maxOutputTokens   | 16–65,536；默认 8,192；遵守已知供应商上限   |
| temperature       | 可留空；通用 0–2 或模型上限，Anthropic 0–1  |
| allowImages       | 显式图片开关；明确不支持时拒绝开启          |
| reasoning         | off / provider-default / on                 |
| reasoningBudget   | 若填写至少 1,024，且小于最大输出 tokens     |
| reasoningStrategy | budget / adaptive / level，显式方言         |
| reasoningEffort   | low / medium / high                         |
| reasoningDisplay  | reasoning / summary，控制公开内容的显示类别 |

通用 Chat Completions 没有统一推理开关，compatibility=standard 时不能配置 on；选 provider-default 可接收返回的公开推理。DeepSeek 用显式 thinking 开关。Anthropic on 使用 budget 或 adaptive，开启时温度留空；Gemini 用 budget 或 level，不支持 adaptive 设置。

这些校验是当前适配契约，个别模型仍可能拒绝某个参数。不要根据统一 UI 认为所有模型支持全部选项。配置可保存后进入诊断确认，供应商升级需增加相应协议 fixtures。

## 7. 协议编码与流解码

[protocols.ts](../src/adapters/model/protocols.ts) 提供 protocolModel、protocolBody 和 protocolTransport。Pi 标准 Message/Tool 输入经协议 body 转 wire；三 decoder 使用统一 DecoderContext/DecoderState，输出 Pi text/thinking/toolCall 流事件。

| 协议      | 编码/回合要点                                                                                        | 结束判据                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Chat      | roles/messages、function tools、tool results，DeepSeek dialect 保留必要 reasoning 内容               | 有效 finish_reason；`[DONE]` 本身不能补足缺少的结束原因；tool_calls 参数片段完整拼接 |
| Anthropic | 顶层 system、content blocks、tool_use/tool_result；保留 thinking signature/redacted blocks           | message_start/stop 与 block 状态，tool_use 要有实际完整调用                          |
| Gemini    | contents/parts、functionDeclarations、functionCall/functionResponse；保留原生 parts/thoughtSignature | candidate finishReason，支持 STOP/MAX_TOKENS 等当前校验                              |

SseDecoder 增量处理任意网络块边界、CRLF 和多行 data；未返回 text/event-stream/body 则失败。requestStream 序列化请求最大 8 MiB、总流响应最大 4 MiB，支持 AbortSignal、超时和 reader 取消。

解码拒绝错协议、流中 error、缺失结束、无效/重复工具标识、超过单轮 32 调用、异常工具 JSON 和无可用最终文字。length 响应中的工具调用不会执行，不完整流不会被转换成“成功工具参数”。同一引擎内工具按 sequential 执行。

## 8. 推理内容与摘要

只展示供应商明确返回的公开内容。Chat 的 reasoning_content/reasoning 可标 reasoning，reasoning_summary 标 summary；Anthropic 的 thinking/redacted_thinking 和 Gemini thought parts 使用配置的显示语义。默认 Chat 显示 reasoning，其余协议默认 summary。

visibility=unavailable 表示服务隐去内容，UI 显示状态，不将签名或 redacted payload 当作文字。reasoningDisplay 是人为/协议配置的公开展示分类，不是“开源/闭源模型身份检测器”；应用不推导隐藏思维链，也不从最终答案反生成推理。

协议签名在同一引擎会话的工具往返中保留以满足服务契约，但公开 Trace 与原始 TranscriptFrame 分离。未来切引擎/协议不能把所有 reasoning 字符串作为任意上下文重放。

## 9. 四种诊断

| kind       | 实际检查                                         | 能说明什么                                       |
| ---------- | ------------------------------------------------ | ------------------------------------------------ |
| connection | 联网获取/合并目录                                | 地址/认证/目录可读；不证明模型能生成             |
| text       | 小输出请求 MOBILE_OK                             | 基础文本生成与结束解析                           |
| tools      | diagnostic_echo 返回宿主随机串，随后要求原样输出 | 工具选择、参数、结果往返；只使用无副作用测试工具 |
| images     | 已知四色图片识别                                 | 图片发送与识别，不能由 text 测试替代             |

诊断通常关闭推理、限制输出至最多 128 tokens，记录 platform、fingerprint、requests 与 totalTokens。tools 往返可能是 2 次模型请求。failed 不自动改成 unsupported，因为认证/网络/参数故障不等于能力不存在；通过后可记录 verified 支持证据。

真实诊断会联网并可能计费；模拟测试不依赖生产 Key。检测记录按平台区分，Web passed 不覆盖原生验证缺口。历史 DeepSeek 真服务记录是历史证据；Anthropic/Gemini 当前以模拟实现验证为主，不能宣称均已真服务验收。

## 10. 新供应商/协议接入

兼容现有 wire 的供应商先用自定义连接与显式兼容选项，不复制一套 RunKernel。新协议需要增加 ModelProtocol、校验/参数规则、body/decoder、目录/认证逻辑和配置 UI，再补至少文本、图片、工具往返、公开推理、截断、取消、错协议及分块测试。

SDK 增加依赖时检查 Metro/Hermes 路径。模型集成代码放 adapters/model，应用层只消费冻结 snapshot/lease，不导入供应商 SDK。

## 11. 源码与测试

[配置服务](../src/application/models/configuration.ts)、[类型](../src/core/models/types.ts)、[规则](../src/core/models/rules.ts)、[HTTP](../src/adapters/model/http.ts)、[catalog](../src/adapters/model/catalog.ts)、[diagnostics](../src/adapters/model/diagnostics.ts)。验证：[provider-protocols.test](../tests/provider-protocols.test.ts)、[model-config.test](../tests/model-config.test.ts)、[model.test](../tests/model.test.ts)、[model-config E2E](../tests/e2e/model-config.spec.ts)。
