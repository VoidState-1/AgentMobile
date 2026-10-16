# 前端路由、工作台与状态维护

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                                         |
| -------- | ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| 2.0.0    | 2026-10-16T19:41:16+08:00 | 8d0bc619e94b2fd44c22ae67d98e5cbd2b2e81e5 | 记录尚未提交源码的工作台职责重组、共享组件覆盖、配置订阅/action 与 UI 入口约束。 |
| 1.3.0    | 2026-10-16T15:39:09+08:00 | d409b141eeeb219779697a62544c17ea23288a12 | 记录尚未提交源码的共享顶栏、视图标签、参数选择、Git 徽标及重组后的页面流程。     |
| 1.2.1    | 2026-10-16T09:00:36+08:00 | 1d594d1c2cda099d7d3633291dfded27628a9a23 | 记录尚未提交源码的单列数值行、删除普通说明、对象详情及分组菜单修正。             |
| 1.2.0    | 2026-10-15T22:42:00+08:00 | 298238947e476284b56933f5f792230a575c5742 | 补充尚未提交源码的无项目导航修复、配置列表与表单层级、说明渐进展开和紧凑弹层。   |
| 1.1.0    | 2026-10-15T22:25:24+08:00 | 5cbd3ef007f5742ee48147e91286ab1ca073a900 | 补充尚未提交源码中的紧凑工作台、树形侧栏、四区底栏及工具分组展示。               |
| 1.0.0    | 2026-10-15T17:24:30+08:00 | 9ad009be8a41df28a02060c5620ee12a29c3d901 | 整理路由、六组视图能力、订阅范围、编辑并发、主题与安全预览。                     |

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

## 2. 工作台职责与视图接口

[useWorkbench](../src/features/workbench/use-workbench.ts) 负责装配查询、编辑会话与以下命令模块。界面暂态仍属于 React，不增加业务数据库或新的全局 store。

| 模块                                                                        | 责任                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [useProjectNavigation](../src/features/workbench/use-project-navigation.ts) | 项目创建、会话切换/命名/归档/恢复、侧栏及切换前的草稿交接         |
| [useTaskActions](../src/features/workbench/use-task-actions.ts)             | 发送前保存、草稿修订提交、停止/子任务取消、提案预览与任务产物路径 |
| [useEditorActions](../src/features/workbench/editor-actions.ts)             | 打开、编辑、保存、导入、重命名、删除及编辑离开保护                |
| [useGitActions](../src/features/workbench/git-actions.ts)                   | 暂存、提交、差异、历史恢复及任务撤销                              |
| [useDialogActions](../src/features/workbench/use-dialog-actions.ts)         | 共用的配置跳转和确认/保存后离开流程                               |

各视图接收明确的接口：`shell` 用于顶栏和主导航，`navigation` 用于项目对话树，`settings` 用于设置入口，`sheets` 用于输入/选择/确认弹层；`conversation`、`editor`、`files`、`git`、`runs` 分别服务对应工作区。删除了反射枚举函数的 CommandBindings 和包揽侧栏、设置、弹层的 dialogs 门面，不为旧调用者保留别名。

[Conversation](../src/features/workbench/conversation.tsx) 组织时间线与建议；[Composer](../src/features/workbench/composer.tsx) 管理输入框高度、焦点、添加菜单和输入工具行；[Exchange](../src/features/workbench/exchange-item.tsx) 负责单条运行详情与产物。草稿继续由 useConversationDraft 持久化，发送仍等待对应修订，不因组件拆分改变存储策略。

工作台使用单层 48px 顶栏，底部为“对话 / 文件 / Git / 设置”四区，键盘弹出时收起底栏。宽度 >=1,100 时项目对话树常驻左侧；窄屏使用 [侧栏覆盖层](../src/features/workbench/project-drawer.tsx)，通过顶栏入口打开、关闭按钮/遮罩/系统返回关闭。当前没有注册侧栏滑动手势，也不覆盖系统边缘返回。文件编辑仍为手机全屏、宽屏侧栏。

[ProjectTree](../src/features/workbench/project-tree.tsx) 直接投影全部项目与其对话，通过缩进表达归属。对话点击切换、长按展开重命名/归档操作，归档模式直接在同一树内恢复。顶栏点击当前对话标题原位修改，项目和对话列表不再使用旧弹窗。侧栏展开时背景从可访问树隐藏；输入型确认仍使用 Sheet。

当前对话的卡片输入框外边距 8px、圆角 8px；添加入口展开资料/技能动作，模型选择与草稿保存状态留在同一工具行。文件列表使用真实目录树、搜索、类型过滤及 Git 标记；项目与对话的切换仍先 flush 草稿，跨项目受编辑 guard 保护。

固定输入区、键盘与短视口回归是手机端主要约束，Web 不能替代 Android/iOS 验收。

四个底栏入口不依赖项目选择，未创建或未选中项目也可往返切换。对话、文件与 Git 在没有项目时显示对应空状态，并提供新建或选择项目入口；项目依赖限制只作用于实际业务操作，不能禁用主导航。

配置页使用同一单层顶栏、固定底部保存区和最大 820px 的内容范围。连接、模型、MCP 和技能条目以紧凑行及分隔线呈现，表单分节不再嵌套圆角卡片。执行预算、模型输出/温度/推理预算、MCP 超时使用单列数值行：名称、输入和单位同排，数值列对齐，范围校验错误在实际保存时呈现，不在每项下面重复范围说明。长地址与正文使用全宽输入。

分节没有普通说明信息按钮，也不显示“如何调用”“使用范围”等常驻教程。系统提示词、预算和模型参数的恢复默认操作放在所属分组的省略号菜单；MCP 工具名点击展开输入定义，行末开关直接表达授权状态。费用、远端自动调用后果、冲突和结果未知等关键信息仍在相应位置显示。模型与技能选择、创建/改名、未保存确认、资源编辑和差异共用小圆角、约 12px 内边距的弹层；触控目标仍至少 44px。

### 2.1 全局组件契约

共享规则必须复用实现，页面不单独绘制同语义的变体：

| 语义              | 组件与规则                                                                             | 当前调用方                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 页面/集合内部切换 | `ViewTabs`：下划线、tablist/tab、选中状态与统一热区                                    | 文件类型、Git 更改/历史、模型目录/收藏、差异文件                                               |
| 参数选择          | `SegmentedControl`：分段底色及选中状态                                                 | 模型参数、认证方式、项目授权范围、外观                                                         |
| 顶栏              | `Toolbar`：单层标题、固定位置的前后操作、统一字号及热区                                | 工作台、配置页、侧栏、阅读器、模型选择及通用弹层                                               |
| 顶栏动作          | `ToolbarAction`：图标复用 `IconButton`；编辑/保存可使用短文字                          | 添加连接/技能、阅读编辑保存                                                                    |
| Git 文件状态      | `GitStatusBadge`：新增绿色、修改橙色、删除红色                                         | 文件树/图片列表、Git 文件、产物、差异                                                          |
| 对象操作行        | `ActionRow`：统一文字层级、选中/按下/禁用与分隔线                                      | 连接/供应商、模型目录、模型/技能选择、技能管理/资源、MCP、设置、参考资料、Git 历史、省略号菜单 |
| 展开入口          | `DisclosureRow`：统一展开语义、箭头和热区                                              | 公开推理、工具步骤/分组、MCP 工具定义                                                          |
| 空状态            | `EmptyState`：标题、可选图标与对象动作，不提供教程式 description                       | 无项目、会话起点、文件/差异、连接/模型/技能筛选、资源与选择器                                  |
| 确认              | `ConfirmSheet`：确认、取消、busy、错误及可选保存动作                                   | 配置删除、资源丢弃、未保存保护、工作台确认、MCP 远端核对                                       |
| 输入              | `Input`：主题、16px 输入字号和唯一的 Web outline reset；`Field` / `NumberField` 组合它 | 所有表单、顶栏改名/搜索、侧栏搜索、正文编辑和 Composer                                         |
| 保存反馈          | `Feedback` / `FormFooter`：统一错误、成功反馈及保存区排列                              | Agent、连接、模型、MCP、技能编辑；共享确认                                                     |
| 凭证编辑          | `CredentialField`：保留/替换/移除交互；不读取凭证存储                                  | 模型 API Key、MCP Token                                                                        |
| 弹层外壳          | `ModalFrame` 提供遮罩、键盘、安全区、顶栏和底栏；`Sheet` 组合滚动正文                  | 通用弹层及保留 FlatList 的模型选择器                                                           |

这些组件按对象语义复用，不把全部列表压成一个万能 schema。项目树保留嵌套与长按行为，Git 文件行保留独立暂存/丢弃操作，编辑器和项目侧栏保留各自的全屏/侧栏外壳。

MCP 的 [UnknownCalls](../src/features/mcp/unknown.tsx) 同时用于全局列表和单连接详情；后者传 serverId 限定查询范围。模型检测的 [CheckResult](../src/features/model-config/check-result.tsx) 同时服务连接与模型详情。SkillPicker 只接收项目、输入和选择/关闭/管理回调，不再依赖工作台控制器。

组件入口位于 [selection](../src/shared/ui/selection.tsx)、[primitives](../src/shared/ui/primitives.tsx) 和 [git-status](../src/shared/ui/git-status.tsx)。底部四区属于主导航，继续使用图标与文字，不与页面内标签混用。

阅读态顶栏只有编辑入口；编辑态显示保存，未修改时可完成编辑。点击保存成功且该编辑身份仍有效、期间无新输入时返回阅读态；快捷保存和未保存保护仍经同一保存用例。删除了重复的阅读/编辑标签栏。

没有模型连接时，页面只有一个添加入口，不显示空搜索或模型目录操作。供应商选择在输入流程的弹层中进行，连接保存后才显示发现/手工添加与目录。设置入口投影当前模型、启用 MCP 数量及技能状态，MCP 数量代表配置启用，不宣称实时连接成功。

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

### 4.1 配置页共用机制

模型、MCP 与 Skills 各自保留领域入口 hook，组合 [useAppServices](../src/shared/use-app-services.ts)、[useServiceSnapshot](../src/shared/use-service-snapshot.ts) 与 [useAction](../src/shared/use-action.ts)。快照通过 useSyncExternalStore 订阅；未初始化时使用稳定的空配置。useAction 提供同步互斥、busy 和 publicError 格式化，配置、Agent 设置、工作台及远端核对共用同一命令生命周期。

[useProjectSelection](../src/shared/use-project-selection.ts) 共用项目加载、持久偏好与手工选择，服务 MCP 和 Skills 授权页面。删除了三个旧 common 文件与组件重导出；调用者直接引用实际所属模块。工作台初始化仍由 useWorkbenchData 负责格式校验与重建流程，不强行合并成普通配置订阅。

[useDraftGuard](../src/shared/use-draft-guard.tsx) 独立处理表单导航保护并复用 ConfirmSheet；与工作台共用 [useBeforeUnload](../src/shared/use-before-unload.ts) 的 Web 离开提示。运行状态文字由 shared/format 的 runStateLabels 统一投影到消息、活动任务和子任务，避免同状态使用不同名称。

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

[theme](../src/shared/theme.ts) 提供语义颜色、typography（正文、标签、辅助信息、元数据、标题）与 workbenchMetrics（顶栏、热区、边距、正文和圆角）；appearance 为 system/light/dark，持久化选择并同步导航与状态栏。业务组件取 theme token，避免只适配浅色的硬编码背景和文字。

shared/ui 提供基础文本、按钮、输入和复合交互；业务文字通过 T 的 variant 选择排版角色。ESLint 禁止页面直接导入原生 Text/TextInput/Modal；TextInput 类型导入可用，只有共享弹层、全屏编辑器和项目侧栏可拥有 Modal 外壳。保持紧凑、清晰的工具风格，关键按钮可访问名称应稳定，便于屏幕阅读器与 Playwright/ADB 定位。模型 Key 等秘密字段不以普通结果文字展示。

设计验收遵循五条规则：屏幕空间承载有效信息；界面元素表达相关的对象、状态与操作；结构本身说明关系；操作依附对象，低频动作进入上下文菜单；文案只补充布局与反馈无法表达的信息。不以机械并列输入框、缩小字体、每项附注或增加信息图标代替信息结构设计。

useAction 的 pending ref 防止同一个界面 action 重复执行；这只是交互约束，服务 revision、锁和幂等不能因此省略。短 notice 到期清除，错误保留到明确动作/状态处理。

## 10. 前端扩展流程与验证

新增交互先查上面的复用表并检查现有调用者，确认不能组合已有组件后再增加新抽象。UI 入口约束由 [测试](../tests/ui-boundaries.test.ts) 验证。新增交互先判断是业务事实还是 UI 瞬时状态；业务能力先增加 AppServices 及用例，UI 再提供操作。新页面复用 shared 主题与服务入口，不接入底层 adapter。

影响保存/切换/订阅需覆盖：等待期间继续输入、同路径重开、旧查询迟到、跨项目通知、草稿切换、深浅主题、360px/短视口、键盘与未保存保护。避免只测试渲染了某个按钮。

验证：[轨迹分组单元测试](../tests/trace-groups.test.ts)、[workbench E2E](../tests/e2e/workbench.spec.ts)、[workspace-live E2E](../tests/e2e/workspace-live.spec.ts)、[trace E2E](../tests/e2e/trace.spec.ts)、[conversations E2E](../tests/e2e/conversations.spec.ts)。
