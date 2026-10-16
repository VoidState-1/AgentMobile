# 前端路由、工作台与状态维护

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                                       |
| -------- | ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| 1.2.1    | 2026-10-16T09:00:36+08:00 | 1d594d1c2cda099d7d3633291dfded27628a9a23 | 记录尚未提交源码的单列数值行、删除普通说明、对象详情及分组菜单修正。           |
| 1.2.0    | 2026-10-15T22:42:00+08:00 | 298238947e476284b56933f5f792230a575c5742 | 补充尚未提交源码的无项目导航修复、配置列表与表单层级、说明渐进展开和紧凑弹层。 |
| 1.1.0    | 2026-10-15T22:25:24+08:00 | 5cbd3ef007f5742ee48147e91286ab1ca073a900 | 补充尚未提交源码中的紧凑工作台、树形侧栏、四区底栏及工具分组展示。             |
| 1.0.0    | 2026-10-15T17:24:30+08:00 | 9ad009be8a41df28a02060c5620ee12a29c3d901 | 整理路由、六组视图能力、订阅范围、编辑并发、主题与安全预览。                   |

## 1. 路由与页面责任

Expo Router 的 `src/app` 只处理页面映射和布局，业务界面在 features。`_layout` 组装 SafeAreaProvider、导航 ThemeProvider、StatusBar 和 Stack。

| 路由                                             | 业务范围                                  |
| ------------------------------------------------ | ----------------------------------------- |
| `/`                                              | 工作台：对话、文件、Git、设置四区及编辑器 |
| `/models`、`/models/connection`、`/models/model` | 供应商连接与模型配置                      |
| `/mcp`、`/mcp/server`                            | 远程服务器、发现与项目授权、未知回执      |
| `/skills`、`/skills/edit`                        | 技能管理、包/资源编辑和版本               |
| `/settings/agent`                                | 系统提示词与执行限制                      |

路由不创建独立工作区或独立 RunKernel，使用同一 bootstrap 服务。进入配置页不会终止活跃任务。UI 不引用 adapters、SQL、GitPort 或凭证存储，文件选择/导出也走 AppServices.io。

## 2. 工作台六组能力

[useWorkbench](../src/features/workbench/use-workbench.ts) 组装内部状态/命令，再通过 memo 的能力对象传给不同组件，不让每个组件拿整个用例状态。

| 能力         | 责任                                                |
| ------------ | --------------------------------------------------- |
| conversation | 当前对话、输入、附件、模型选择、发送/取消与对话交互 |
| editor       | 文件编辑/阅读、名称、保存、未保存保护与导出         |
| files        | 文件列表、搜索、导入、新建、打开                    |
| git          | 状态、差异、暂存、提交、历史加载与恢复/撤销预览     |
| runs         | 当前/历史任务、详情、轨迹、子任务和提案查看         |
| dialogs      | 项目对话树、设置导航、输入弹层、确认与页面切换      |

命令通过稳定引用与最新状态桥接，视图能力按实际依赖更新。优化时不要把一个大型 controller 再传遍全部组件，也不要为每个简单按钮新建空壳 hook。

工作台使用单层 48px 顶栏，底部为“对话 / 文件 / Git / 设置”四区，键盘弹出时收起底栏。宽度 >=1,100 时项目对话树常驻左侧；窄屏使用 [侧栏覆盖层](../src/features/workbench/project-drawer.tsx)，通过顶栏入口打开、关闭按钮/遮罩/系统返回关闭。当前没有注册侧栏滑动手势，也不覆盖系统边缘返回。文件编辑仍为手机全屏、宽屏侧栏。

[ProjectTree](../src/features/workbench/project-tree.tsx) 直接投影全部项目与其对话，通过缩进表达归属。对话点击切换、长按展开重命名/归档操作，归档模式直接在同一树内恢复。顶栏点击当前对话标题原位修改，项目和对话列表不再使用旧弹窗。侧栏展开时背景从可访问树隐藏；输入型确认仍使用 Sheet。

当前对话的卡片输入框外边距 8px、圆角 8px；添加入口展开资料/技能动作，模型选择与草稿保存状态留在同一工具行。文件列表使用真实目录树、搜索、类型过滤及 Git 标记；项目与对话的切换仍先 flush 草稿，跨项目受编辑 guard 保护。

固定输入区、键盘与短视口回归是手机端主要约束，Web 不能替代 Android/iOS 验收。

四个底栏入口不依赖项目选择，未创建或未选中项目也可往返切换。对话、文件与 Git 在没有项目时显示对应空状态，并提供新建或选择项目入口；项目依赖限制只作用于实际业务操作，不能禁用主导航。

配置页使用同一单层顶栏、固定底部保存区和最大 820px 的内容范围。连接、模型、MCP 和技能条目以紧凑行及分隔线呈现，表单分节不再嵌套圆角卡片。执行预算、模型输出/温度/推理预算、MCP 超时使用单列数值行：名称、输入和单位同排，数值列对齐，范围校验错误在实际保存时呈现，不在每项下面重复范围说明。长地址与正文使用全宽输入。

分节没有普通说明信息按钮，也不显示“如何调用”“使用范围”等常驻教程。系统提示词、预算和模型参数的恢复默认操作放在所属分组的省略号菜单；MCP 工具名点击展开输入定义，行末开关直接表达授权状态。费用、远端自动调用后果、冲突和结果未知等关键信息仍在相应位置显示。模型与技能选择、创建/改名、未保存确认、资源编辑和差异共用小圆角、约 12px 内边距的弹层；触控目标仍至少 44px。

## 3. 状态归属

| 状态                                                                      | 归属                                               |
| ------------------------------------------------------------------------- | -------------------------------------------------- |
| 项目/会话、配置、文件、Git、任务、轨迹                                    | AppServices 的业务事实；hook 保存查询投影          |
| 目标草稿与附件                                                            | ConversationService 持久化；输入 hook 跟踪保存状态 |
| projectId/conversationId/tab/appearance/commitDrafts                      | Zustand 界面状态                                   |
| 项目选择/主题持久偏好                                                     | PreferencesService；Zustand 只是投影               |
| EditorDocument、drawerOpen、弹层、review、confirmation、busy/error/notice | React 内存                                         |
| Agent 活跃执行                                                            | RunKernel；页面不拥有执行生命周期                  |

commitDrafts 是按项目分开的界面说明草稿，当前没有写入 PreferencesService；对话目标草稿则是真正持久化的数据。不要因为两者都叫草稿而假设行为相同。

## 4. 数据查询与实时订阅

[useWorkbenchData](../src/features/workbench/use-workbench-data.ts) 负责初始化、项目 snapshot、Run 分页和订阅：

- workspace recorded 通知刷新当前项目文件/Git，合并连续通知，避免每个模型 token 都读整个文件树。
- models/conversations 的快照订阅更新当前配置/对话目录。
- agent 快照订阅更新活跃运行与公开错误，文件刷新不依赖完成状态。
- runs 变更按当前 project/conversation/root 范围刷新历史，子任务独立查询。

查询使用 refreshId/historyRequest/scope 和当前 UI 选择作晚到结果过滤。显示投影的 snapshotProjectId/taskScope 不属于当前选择时直接显示空/加载状态，不先用旧项目数据冒充新项目。

历史加载更多按 id/OID 去重，刷新首批后保留用户已展开旧页。切换项目或会话时重建查询 scope，旧 cursor 不带入新范围。

## 5. 编辑会话身份与保存

[EditorDocument](../src/features/workbench/types.ts) 保存 identity Symbol、projectId/path/revision、当前与已保存 text/name，以及 image/reading/fresh/externalChanged。每次重新打开文件生成新 identity，即使 path 相同也属于新的编辑会话。

[useEditorSession](../src/features/workbench/use-editor-session.ts) 提供唯一 setEditor，同步更新 ref 和 state。不要其他代码直接写 editorRef，否则下一次异步命令读取的内容与已显示 UI 会分叉。

保存捕获当前 EditorDocument，写完后只更新相同 identity 的会话：

1. 若期间无新输入，更新 revision/savedText/savedName；可关闭。
2. 若期间继续输入，保留最新 text/name，只更新已保存基线和修订，仍显示未保存。
3. 若旧会话已关闭后重新打开，即使路径一致，旧回执也不覆盖新会话。
4. 保存并离开期间若新增输入，提示冲突并留在编辑器，不静默丢弃。

文件写与重命名是多个独立用例，并非一个整体 UI 事务；其中一步失败时保持可辨认状态，重新读取并确认，不盲目重放。根任务占用项目时宿主拒绝手工保存。

## 6. 外部变化与未保存保护

工作区通知到达后，打开文件 revision 改变：无本地脏内容则用 preview 更新；有本地修改则保留并置 externalChanged；外部删除且无脏修改则关闭。读取前后的编辑 identity/revision 都匹配才应用结果。

dirty 为 fresh 或 text/name 与 savedText/savedName 不一致。切项目、关闭编辑器等受 guard 保护，用户可保存后继续或放弃；确认结构中的 afterPerform 保存原导航动作，不能确认后忘记执行原选择。

Web 在编辑或目标草稿尚未保存时设置 beforeunload 提示。原生仅已有界面内离开保护，没有保证进程被杀前把编辑器未保存文本自动恢复；目标草稿经业务库保存，行为不同。

## 7. 运行与轨迹视图

会话时间线按目标、执行步骤、最终结果组织，text/reasoning/tool 轨迹内联展示。历史先查询摘要，初始三条渲染项预取详情，避免路由切换期间可见性回调尚未触发而一直显示加载；其余项进入可见区后读取详情。节点和长正文仍分页读取，子任务通过 childRunIds 关联步骤，writer 提案可查看独立差异。

最终 response 单独来自 RunDetail，不依赖前 50 个节点已全部载入。推理标签使用 visibility，不通过模型名称推断开源/闭源身份；unavailable 显示不可用状态。

[trace-groups](../src/features/workbench/trace-groups.ts) 只合并相邻 tool 节点。正文和公开推理始终构成分组边界，不能为折叠工具而挪动顺序。读取、搜索、图片、修改、Git、Skills、MCP、子 Agent 使用各自图标；单调用直接展开详情，多调用以次数摘要默认折叠，展开内容最高 280px 并可独立滚动。含子任务或异常回执的组默认展开，收起后仍显示异常摘要。分页追加沿用首个节点 ID，保留展开状态；原始轨迹与持久化结构不变。

产物使用紧凑文件行：文件名打开当前项目文件，变化图标查看该任务的历史差异。已移动/删除的文件不能直接打开，历史差异仍可查看。

当前实现仍有活跃运行的内存 trace 和内部完整读取路径，UI 分页不能代替整个内核的长任务内存审计。

## 8. Markdown 与图片

[Markdown](../src/features/workbench/markdown.tsx) 使用原生组件实现常见子集：标题 1–3、粗体、行内代码、代码围栏、无序列表、引用、分隔线及独立行图片。不是完整 CommonMark/HTML renderer，不承诺表格、全部嵌套结构或可执行 HTML。

图片相对 Markdown 文件目录解析，允许在项目内消解 `.`/`..`，最终经 safePath 校验；拒绝 scheme、绝对地址、反斜杠和越出工作区根的路径，不自动加载外部图片。UI load 回调通过业务 preview 取得 data URI。

图片异步加载以 source 与 load 函数身份过滤，资料删除/变化后不得复用旧 URI。文件缺失显示不可用；原始图片保留，当前没有图片编辑器或生成能力。

## 9. 主题与交互约定

[theme](../src/shared/theme.ts) 提供语义颜色与 workbenchMetrics（顶栏、热区、边距、正文和圆角）；appearance 为 system/light/dark，持久化选择并同步导航与状态栏。业务组件取 theme token，避免只适配浅色的硬编码背景和文字。

shared/ui 提供基础文本、按钮、输入、图标等。保持紧凑、清晰的工具风格，关键按钮可访问名称应稳定，便于屏幕阅读器与 Playwright/ADB 定位。模型 Key 等秘密字段不以普通结果文字展示。

设计验收遵循五条规则：屏幕空间承载有效信息；界面元素表达相关的对象、状态与操作；结构本身说明关系；操作依附对象，低频动作进入上下文菜单；文案只补充布局与反馈无法表达的信息。不以机械并列输入框、缩小字体、每项附注或增加信息图标代替信息结构设计。

busyRef 防止同一个界面 action 重复执行；这只是交互约束，服务 revision、锁和幂等不能因此省略。短 notice 到期清除，错误保留到明确动作/状态处理。

## 10. 前端扩展流程与验证

新增交互先判断是业务事实还是 UI 瞬时状态；业务能力先增加 AppServices 及用例，UI 再提供操作。新页面复用 shared 主题与服务入口，不接入底层 adapter。

影响保存/切换/订阅需覆盖：等待期间继续输入、同路径重开、旧查询迟到、跨项目通知、草稿切换、深浅主题、360px/短视口、键盘与未保存保护。避免只测试渲染了某个按钮。

验证：[轨迹分组单元测试](../tests/trace-groups.test.ts)、[workbench E2E](../tests/e2e/workbench.spec.ts)、[workspace-live E2E](../tests/e2e/workspace-live.spec.ts)、[trace E2E](../tests/e2e/trace.spec.ts)、[conversations E2E](../tests/e2e/conversations.spec.ts)。
