# Agent Mobile 前端代码质量深度评估报告

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                                           |
| :------- | :------------------------ | :--------------------------------------- | :--------------------------------------------------------------------------------- |
| 1.0.0    | 2026-10-16T19:10:00+08:00 | 8d0bc619e94b2fd44c22ae67d98e5cbd2b2e81e5 | 针对“结构清晰度、全局一致性、组件拆分复用”三个核心维度完成深度严苛审计与架构评估。 |

---

## 1. 评估总览与核心结论

基于对当前代码基线（HEAD: `8d0bc619e94b2fd44c22ae67d98e5cbd2b2e81e5`）中 `src/app`、`src/features`、`src/shared` 共计 56 个前端文件、10,364 行代码的全面逐行静态审查，并结合全量架构边界检查（`npm run check` 30 个测试文件、195 项测试全部通过）以及运行时交互链路的深入分析，得出以下评估结论：

> **总体结论：**
> 本项目的前端工程在**分层架构边界**与**跨端可访问性（A11y）** 上表现优秀，基础设施与类型系统扎实；但在**组件解耦粒度**、**渲染性能控制**、**样式工程化**以及**状态集中度（上帝 Hook）** 方面存在较严重的结构性硬伤。
> 整体属于典型的**“核心分层规范扎实，但 UI 表现层与交互状态层偏向紧耦合重装配”**的代码形态。

### 综合质量评分表（满分 10.0，以严苛工业级标准评定）

| 审计维度                                     |  得分   |     评级     | 核心判定依据                                                                                                                           |
| :------------------------------------------- | :-----: | :----------: | :------------------------------------------------------------------------------------------------------------------------------------- |
| **结构清晰度（Architecture Structure）**     | **7.0** |  良好但失衡  | 平台分层边界分明，ESLint 静态规则有效阻断越界；但存在 943 行的“上帝 Hook”与数百行单文件过度集权。                                      |
| **全局一致性（Global Consistency）**         | **6.5** |   中等偏弱   | 主题色板与 A11y 落实到位；但样式系统完全内联化无静态约束，数据流样板代码在各 Feature 间高度重复且错误规范不收敛。                      |
| **组件拆分复用（Component Decomposition）**  | **6.0** |   尚需重构   | 基础 UI 原语（Primitives/Forms）沉淀良好；但复合业务组件（Composer/Trace）严重过载，通用场景（EmptyState/Confirm）存在明显重复造轮子。 |
| **渲染与性能工程（Rendering Performance）**  | **5.5** | 存在明显隐患 | 高频受控输入直接触发全屏级联重渲染，FlatList 虚拟化依赖频繁破损，大文本编辑缺乏性能保护，样式匿名对象加剧 GC。                         |
| **类型与工程稳健性（Typing & Engineering）** | **8.5** |     优秀     | 全量 TypeScript 严格类型推导，无 any 泛滥，测试用例健全，分层架构受自动化守卫保护。                                                    |

---

## 2. 维度一：结构是否清晰？

### 2.1 表现出色的结构设计

1. **严格的分层边界与架构防护**
   - 严格践行了 [AGENTS.md](../AGENTS.md) 的分层设计：`src/core` 保持纯净的领域逻辑（无 React、Expo 或原生库依赖）；`src/application` 提供门面用例；`src/bootstrap` 组装服务单例。
   - 前端代码严禁直接穿透到底层 adapters、SQLite 数据库或原生模块，这一边界由 [`tests/architecture-boundaries.test.ts`](../tests/architecture-boundaries.test.ts) 进行静态与动态导入验证，分层约束执行极为刚性。
2. **轻薄清晰的路由层**
   - [`src/app`](../src/app) 目录仅作为 Expo Router 的文件式路由壳子（平均每个路由文件 5~10 行），全部将展示逻辑委托给 `src/features` 下对应的业务组件，路由职责十分清晰。

### 2.2 严苛视角下的严重缺陷

#### (1) 上帝 Hook 反模式（God Hook Anti-pattern）

- **典型案例：** [`src/features/workbench/use-workbench.ts`](../src/features/workbench/use-workbench.ts)（943 行）。
- **问题分析：**
  - 该 hook 试图作为整个 Workbench 的单一状态控制中枢，内部聚合了：`ui` 状态、`runtimeRef`、`busy` 互斥锁、`editorSession`、`composer`、`attachment`、`draft`、`sqlite/git` 轮询数据、`runs` 状态、`gitActions`、`editorActions` 等。
  - 其返回的 `dialogs` 门面对象拥有超过 50 个字段；其 [`useMemo` 依赖数组长达 53 个变量](../src/features/workbench/use-workbench.ts#L880-L932)。
  - **结构弊病：** 这种设计导致本属于不同关注点的状态（如输入框的打字草稿、抽屉开闭、Git 提交列表、文件重命名、删除弹窗等）全部绑定在同一执行上下文。任何微小的状态变动，都会引发整个 hook 的重算，进而击穿到 `WorkbenchScreen`。

#### (2) 页面级单文件过度膨胀与职责混杂

- **典型案例：**
  - [`src/features/model-config/model.tsx`](../src/features/model-config/model.tsx)（589 行）
  - [`src/features/skills/editor.tsx`](../src/features/skills/editor.tsx)（528 行）
  - [`src/features/mcp/server.tsx`](../src/features/mcp/server.tsx)（480 行）
  - [`src/features/model-config/connection.tsx`](../src/features/model-config/connection.tsx)（491 行）
- **问题分析：**
  这些文件均采用“一个文件包办一切”的模式：包含参数校验逻辑、网络连通性探测（Probe）、版本冲突对比、全套表单控件定义、以及数个嵌套的 Sheet/Modal 确认弹窗。单文件闭包层级过深，组件间状态与业务逻辑高度耦合，缺乏清晰的子目录分工。

---

## 3. 维度二：全局一致性做的是否到位？

### 3.1 表现到位的规范

1. **主题与设计基准统一**
   - [`src/shared/theme.ts`](../src/shared/theme.ts) 统一管理 light/dark 色板以及基础度量（`workbenchMetrics`：44pt 触控最小高度、8pt 圆角等），并通过 [`src/app/_layout.tsx`](../src/app/_layout.tsx) 与 Expo Navigation 深度绑定，全局暗黑模式切换连贯。
2. **无障碍语义（A11y）全面贯彻**
   - 几乎所有自定义可点击区域均显式声明了 `accessibilityRole="button"`、`accessibilityLabel`、`accessibilityState`，Tab 列表声明了 `accessibilityRole="tablist"` 和 `aria-selected`，标准执行非常自觉。
3. **表单守卫（Draft Guard）逻辑统一**
   - 统一抽象了 [`useDraftGuard`](../src/shared/ui/forms.tsx)，在全应用表单编辑页面中标准化拦截未保存退出，同时兼容 Web 端 `beforeunload` 与原生导航的 `usePreventRemove`。

### 3.2 严苛视角下的严重不一致

#### (1) 样式工程体系彻底失守：内联对象泛滥（Inline Styles Anti-Pattern）

- **全项目几乎没有使用 `StyleSheet.create()`**，绝大多数样式直接以字面量形式内联写在 JSX 中（例如 `style={{ minHeight: 44, paddingHorizontal: 10, backgroundColor: theme.surface }}`）或动态函数中（`style={({ pressed }) => ({ ... })}`）。
- **严苛审查弊端：**
  - **GC 压力加剧：** 每次组件 render 都会在堆上分配数百个临时匿名样式对象；
  - **原生样式优化失效：** 无法利用 React Native 在原生层对 StyleSheet ID 的静态缓存机制；
  - **规范漂移（Design Token 缺失）：** 缺乏统一的 Typography（排版）与 Spacing（间距）Token，源码中散布着任意手写的 `fontSize: 10`、`11`、`12`、`13`、`14`、`15`、`16`、`18`、`22`，以及不规则的 padding 与 gap（如 `gap: 5`、`gap: 7`、`padding: 3`），视觉韵律缺少系统约束。

#### (2) 状态管理与数据加载样板代码高度重复且规范分裂

- 在 [`src/features/model-config/common.tsx`](../src/features/model-config/common.tsx)、[`src/features/skills/common.ts`](../src/features/skills/common.ts)、[`src/features/mcp/common.ts`](../src/features/mcp/common.ts) 中，完全相同的逻辑被复制粘贴了三次：
  ```ts
  const [runtime, setRuntime] = useState<Runtime>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const working = useRef(false);
  // 重复手写 getAppServices() 初始化与 subscribe 订阅
  // 重复手写 working.current 并发互斥锁 action 包装
  ```
- **更不一致的是：**
  - [`src/features/agent-settings/screen.tsx`](../src/features/agent-settings/screen.tsx) 使用了封装好的 [`useAppServices`](../src/shared/use-app-services.ts)，而上述三个模块却弃用该 hook 自己直调底层函数；
  - 错误处理在 `model-config` 采用 `reason instanceof Error ? reason.message : '操作失败'`，而在 `skills` 和 `mcp` 却采用 `publicError(reason).message`。全局错误处理契约未收敛。

#### (3) 违背项目 Clean Code 规范的重导出（Re-export）

- 在 [`src/features/model-config/common.tsx` 第 8 行](../src/features/model-config/common.tsx#L8)：
  ```ts
  export {
    useDraftGuard,
    ConfigPage,
    FormScroll,
    Section,
    Toggle,
    Loading,
  } from '@/shared/ui/forms';
  ```
  [AGENTS.md](../AGENTS.md) 明确要求：“_不为旧原型保留兼容别名、重导出、双写、Legacy DTO_”。此处的重导出使得调用方导入路径产生歧义（有的从 common 导，有的从 forms 导），属于明令禁止的过渡层残留。

#### (4) 跨端兼容补丁防御式散落

- 在多个文件（`primitives.tsx`、`forms.tsx`、`screen.tsx`、`conversation.tsx` 等）中，反复出现裸写的平台分支与类型断言：
  ```ts
  ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : {})
  ```
  缺乏统一的 Web 跨端输入重置基元（Reset Primitive），导致防御性断言散布各处。

---

## 4. 维度三：有没有合理拆分复用组件？

### 4.1 拆分与复用良好的部分

- **原子原语层建设完整：**
  - [`src/shared/ui/primitives.tsx`](../src/shared/ui/primitives.tsx)：统一封装了 `T`（语义化排版）、`Toolbar`、`ToolbarAction`、`Button`、`IconButton`、`Field`、`Sheet` 等原子组件；
  - [`src/shared/ui/forms.tsx`](../src/shared/ui/forms.tsx)：抽象了 `ConfigPage`、`FormScroll`、`Section`、`NumberField`、`Toggle` 等表单容器与输入单元；
  - [`src/shared/ui/selection.tsx`](../src/shared/ui/selection.tsx)：抽象了 `ViewTabs` 与 `SegmentedControl`。
    上述组件为整个应用提供了统一的工具软件质感。

### 4.2 严苛视角下的拆分不足与复用缺失

#### (1) 复合业务组件严重过载（缺乏向下细分拆解）

- **案例 1：[`Conversation.tsx`](../src/features/workbench/conversation.tsx)（535 行）**
  - **Composer 输入区域**占据近 200 行代码，包含了：参考文件药丸胶囊、多行高度自适应输入框、快捷提问建议 Chips、技能与附件弹层触发、模型快速选择下拉菜单、草稿保存中旋转指示器、发送/中止复合按钮。
  - **严重缺陷：** 所有状态与 JSX 杂糅在单一组件内。应该严格拆分为 `<Composer />`、`<AttachmentPill />`、`<SuggestionChips />`、`<ModelIndicator />`。
  - **单条消息项 `Exchange`** 内部直接调用 API 获取 Trace 和 Children，将数据拉取与渲染强耦合，未独立成文件。
- **案例 2：[`trace.tsx`](../src/features/workbench/trace.tsx)（606 行）**
  - 单个文件内堆砌了 `FinalResponse`、`TraceText`、`Reasoning`、`ToolStep`、`ChildTrace`、`TaskTrace` 六个完整组件，代码行数破 600 行。
  - 推理展开折叠、工具执行状态、子 Agent 运行嵌套均写在同一个作用域，代码可读性与可维护性较差，应拆分为独立的 `trace/` 子目录。

#### (2) 高频通用业务场景缺少提炼（重复造轮子）

- **通用空状态（EmptyState）缺失：**
  - `screen.tsx` 自写 `ProjectEmptyState`；
  - `conversation.tsx` 自写 `ListEmptyComponent`（从一个目标开始）；
  - `review.tsx` 自写无差异对比占位；
  - `history.tsx` 自写无提交记录占位。
    全项目缺乏一个标准的 `<EmptyState icon={...} title={...} description={...} action={...} />`。
- **确认删除弹窗（ConfirmSheet）未标准化：**
  - 各配置编辑页面（`model.tsx`、`connection.tsx`、`skills/editor.tsx`、`mcp/server.tsx`）均在底部用十几行 JSX 手写一套包含“确认删除该配置吗？此操作不可撤销”以及取消/删除按钮的 Sheet。

#### (3) 极简 Markdown 渲染器的复用边界问题

- [`src/features/workbench/markdown.tsx`](../src/features/workbench/markdown.tsx) 采用约 200 行的手写纯正则匹配渲染 Markdown。
- **局限性：** 虽然杜绝了 XSS 风险并实现了跨端免 Webview，但不支持表格、有序序号列表（`1. 2.` 会被当成普通段落）、行内链接等。作为定位于开发者代码助手的核心客户端，在渲染 Agent 产生的复杂结构化回复时存在明显的功能缺失。

---

## 5. 深度专项：渲染性能与交互可用性审查

在严苛标准下，代码中存在几处会直接导致移动端交互卡顿与虚拟化失效的**性能硬伤**：

### 5.1 受控输入导致的全屏级联重渲染（Cascade Re-rendering）

- **调用链分析：**
  1. 用户在 [`Conversation.tsx`](../src/features/workbench/conversation.tsx) 的输入框打字；
  2. 触发 `onChangeText={controller.setPrompt}`；
  3. `prompt` 状态由全局的 [`useWorkbench`](../src/features/workbench/use-workbench.ts) 中的 `useConversationDraft` 维护；
  4. 顶层 `useWorkbench` 重新执行并生成全新的 `capabilities.conversation` 引用；
  5. 顶层组件 `WorkbenchScreen` 重渲染；
  6. 子组件 `Conversation` 重渲染；
  7. `FlatList` 重新计算虚拟化切片。
- **后果：** 键盘**每敲击一个字符**，就触发一次从顶层容器到全屏子树的自顶向下全量重渲染。在低端 Android 或重载运行环境下，会产生显著的输入掉帧与打字延迟（Input Latency）。
- **类似问题：** [`src/features/workbench/editor.tsx`](../src/features/workbench/editor.tsx) 中大文件编辑的受控输入也有同样的性能陷阱。

### 5.2 FlatList 虚拟化优化被无意识破坏

- 在 [`Conversation.tsx`](../src/features/workbench/conversation.tsx#L196-L245) 中：
  ```tsx
  // 1. 每次组件执行，都在内存中重新 filter/map 构造全新的 tasks 数组引用
  const tasks: ExchangeRow[] = controller.tasks.filter(...).map(...);

  // 2. renderItem 传的是内联箭头函数，每次渲染都会生成全新的函数闭包
  renderItem={({ item, index }) => (
    <Exchange row={item} visible={...} controller={controller} />
  )}
  ```
- **后果：** 尽管 `Conversation` 使用了 `memo`，但因为父级重渲染传入的 `controller` 引用变动，导致 `memo` 完全击穿。同时 `data` 和 `renderItem` 引用全变，FlatList 无法有效识别 item 复用，所有可见历史项的 `Exchange` 都会被迫连带执行 render。

### 5.3 缺乏客户端数据缓存导致的重复 IO

- 单条消息 [`Exchange`](../src/features/workbench/conversation.tsx#L58-L85) 依赖其自身的 `useEffect` 调用 `Promise.all([api.getDetail, api.listTrace, api.listChildren])`。
- 当长列表上下滚动时，被 FlatList 回收的 cell 再次进入可视区，如果不是 live run，由于缺乏统一的数据层缓存（如 React Query / 规范化 Store），会重新触发底层存储读取，浪费设备 I/O 与电量。

---

## 6. 整改与重构路线图

针对上述审计发现，建议按以下三阶段展开重构：

### 阶段一：阻断级联重渲染与破坏性规范清理（优先落地）

1. **输入框状态就地下沉：**
   - 将 `Conversation` 的输入草稿收敛为本地非受控或局部 state，输入时不向外冒泡，仅在防抖（Debounce）存草稿、失焦（Blur）或点击发送时通知顶层服务，彻底切断键盘打字对全屏幕的级联重渲染。
2. **清理违规重导出与统一样板代码：**
   - 彻底删除 `src/features/model-config/common.tsx` 的组件重导出，直接由各模块从 `@/shared/ui/forms` 引入；
   - 提取通用的 `useAsyncAction` 基础 hook，统一管理并发锁 `working.current`、`busy`、`error` 与 `publicError` 格式化，消除各 Feature 的大量重复代码。

### 阶段二：解构上帝 Hook 与模块化拆分（结构治理）

1. **解构 `use-workbench.ts`：**
   - 将 943 行的庞大 hook 拆分为四个独立的 Context 或 Zustand 领域切片：
     - `EditorContext`（文档会话、脏标记、保存与导出）；
     - `ConversationContext`（当前对话、运行状态、草稿）；
     - `GitContext`（差异对比、提交历史、状态）；
     - `WorkbenchUIContext`（抽屉、Tab、弹窗路由）。
2. **下拆臃肿组件：**
   - 将 `Conversation.tsx` 拆分出独立的 `<Composer />` 与 `<ExchangeItem />`；
   - 将 `trace.tsx` 拆分为 `trace/` 子目录，独立管理 Reasoning、ToolStep、ChildTrace。

### 阶段三：样式工程化与通用业务原语完善（体验与维护性提升）

1. **样式迁移至 `StyleSheet.create`：**
   - 将大量硬编码的内联样式对象抽离为 `StyleSheet` 静态定义，动态主题样式通过数组组合（`[styles.base, { backgroundColor: theme.surface }]`），阻断匿名对象堆内存分配。
2. **补全通用业务组件：**
   - 抽象通用的 `<EmptyState />` 组件，统一全应用的空状态视觉规范；
   - 抽象通用的 `<ConfirmSheet />` 组件，收敛全应用的危险操作/删除确认弹层。
3. **增强 Markdown 渲染能力：**
   - 扩充 `markdown.tsx` 对有序列表、代码块语言高亮标牌、表格的基础展示支持，保障 Agent 丰富回答的呈现效果。
