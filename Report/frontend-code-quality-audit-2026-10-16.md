# Agent Mobile 前端代码质量审计报告

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                                       |
| -------- | ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| 1.0.0    | 2026-10-16T17:07:09+08:00 | 8d0bc619e94b2fd44c22ae67d98e5cbd2b2e81e5 | 完成前端源码审计、现有检查与隔离浏览器复现，记录缺陷、结构风险及整改验收条件。 |

## 1. 审计结论

**宏观分层清晰，共享 UI 已形成基础，但前端内部职责拆分、失败路径和全局一致性仍未达到严苛标准。** 当前代码适合继续迭代，尚不宜把“类型、lint、现有测试通过”作为前端质量已达标的依据。

对本次问题的直接回答：

| 关注点               | 结论                                         | 依据                                                                                                                              |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 结构是否清晰         | 外层清晰，工作台内部仍过度集中               | 路由只有 49 行；工作台控制 hook 有 942 行，dialogs 能力对象仍包含 52 个字段。                                                     |
| 全局一致性是否到位   | 视觉基础较统一，生命周期与行为一致性不足     | 主题颜色、顶栏、表单、Git 状态已有复用；配置直达时主题错误，初始化失败展示不同，触控尺寸和键盘行为不一致。                        |
| 组件是否合理拆分复用 | 已有有效复用，也存在明确的重复和耦合         | Button、Field、Toolbar、ViewTabs 等应保留；配置控制逻辑重复三份，ModelPicker 重复弹层外壳，SkillPicker 反向依赖工作台控制器类型。 |
| 正确性与数据保护     | 存在需要优先修复的缺陷                       | 组合输入回车误发送、删除失败后丢失未保存保护、配置初始化错误不可见。                                                              |
| 性能是否可靠         | 有局部优化，规模边界尚不充分                 | 对话虚拟化、轨迹分页已实现；文件树全量渲染、原图缩略图、逐字整份会话状态持久化仍有风险。                                          |
| 测试是否充分         | 现有行为回归较好，关键故障和可访问性场景遗漏 | 本次 195 项单元测试和 53 项 E2E 全部通过，额外复现仍确认多项缺陷。                                                                |

共记录 **17 项问题：P1 3 项、P2 13 项、P3 1 项**。其中包含功能缺陷、结构风险和验证体系缺口，不把它们都视为用户已经遭遇的线上故障。

**优先级定义：** P1 为可能引发非预期任务、编辑丢失或关键入口失效的问题；P2 为明确影响正确性、可用性、维护成本，或缺少必要防线的问题；P3 为不阻断主流程的维护改进。未发现有充分证据支持的 P0 问题；这不等于完成了安全认证。

## 2. 范围、方法与证据边界

### 2.1 审计对象

逐文件审阅了 `src/app`、`src/features`、`src/shared` 的全部 56 个 TypeScript/TSX 文件，并追踪相关 AppServices、模型配置、会话持久化、Git 差异、架构规则和前端测试。源码统计不包含依赖、生成原生工程和测试文件。

| 目录           | 文件数 |   行数 |
| -------------- | -----: | -----: |
| `src/app`      |     10 |     49 |
| `src/features` |     37 |  9,179 |
| `src/shared`   |      9 |  1,136 |
| 合计           |     56 | 10,364 |

统计按去除文件尾部空白后的文本行计算，不代表有效逻辑行数。存在 426 处 JSX `style={{...}}`；这个数量本身不构成缺陷，只有重复语义、规则漂移或不必要的维护负担才构成整改理由。

审计开始时 HEAD 为 `d409b141eeeb219779697a62544c17ea23288a12`，工作区包含较多未提交变更；审计中这些变更被提交为 `8d0bc619e94b2fd44c22ae67d98e5cbd2b2e81e5`。本报告按最终提交记录代码基线，检查覆盖了这些实际源码。审计没有改动产品源码、依赖、业务数据格式或现有测试。

### 2.2 实际执行的验证

| 验证                                                                                                                 | 本次结果                        | 能证明的范围                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run check`                                                                                                      | 通过；30 个测试文件、195 项测试 | TypeScript、当前 ESLint 规则、当前 Vitest 用例。                                           |
| `npm run build:web`                                                                                                  | 通过                            | 当前源码可以完成 Expo Web 导出。                                                           |
| `npx playwright test --workers=2`                                                                                    | 53 项通过，约 1.5 分钟          | Chrome + Web + IndexedDB + 测试内模拟协议。                                                |
| `npx prettier --check src/app src/features src/shared tests/e2e eslint.config.js playwright.config.ts tsconfig.json` | 通过                            | 上述前端目录和配置的代码格式。                                                             |
| 审计补充场景                                                                                                         | 完成                            | 组合输入事件、存储失败、导航保护、主题直达、Markdown、差异尾部、热区与键盘、草稿写入次数。 |
| 架构 lint 探针                                                                                                       | 完成                            | 证明现有规则不能阻止部分明确禁止的依赖。                                                   |
| 颜色对比度计算                                                                                                       | 完成                            | 依据当前 token 的 sRGB/WCAG 公式计算，不等于完整页面可访问性评估。                         |

浏览器复现使用新建的隔离 context，只写入合成项目和合成文本。网络调用使用演示模式或现有测试内模拟协议，没有使用用户凭证调用真实模型。存储失败通过该隔离页面内的 IndexedDB 方法注入，不作用于用户常用浏览器实例。

**本次未执行 Android/iOS 原生 UI、真机性能、屏幕阅读器人工操作和真实供应商验收。** 因此不对系统返回、输入法机型差异、原生内存峰值或 Hermes 帧率作通过结论。原生相关影响会明确标记为待验证。

### 2.3 证据附件

- [浏览器复现记录](frontend-audit-2026-10-16-evidence/results.json)
- [删除失败补充记录](frontend-audit-2026-10-16-evidence/supplementary-failed-skill.json)
- [热区与键盘补充记录](frontend-audit-2026-10-16-evidence/supplementary-short-touch.json)
- [源码统计、颜色对比度和 lint 探针](frontend-audit-2026-10-16-evidence/metrics.json)
- [浏览器复现脚本](frontend-audit-2026-10-16-evidence/reproduce.mjs)
- [静态测量脚本](frontend-audit-2026-10-16-evidence/measure.mjs)

脚本从仓库根目录运行。先执行 `npm run build:web`，在单独终端运行 `npm run preview`，然后执行：

```powershell
node Report/frontend-audit-2026-10-16-evidence/reproduce.mjs
node Report/frontend-audit-2026-10-16-evidence/measure.mjs
```

它们是审计取证脚本，输出观察结果，不是已经接入持续集成的断言测试。复跑会覆盖本目录同名证据文件；在整改验证时应先保留本次证据。单个浏览器场景的执行异常会写入结果中的 `error` 字段，不能被解释为产品缺陷已复现或已修复。

## 3. 已有的良好基础

这些基础值得保留，不能为了“严苛”而忽略：

1. **路由与业务页面基本分离。** [app 布局](../src/app/_layout.tsx) 和其余路由是薄层，features 实际承载界面。
2. **当前 UI 调用业务主要经过 AppServices。** 没有在本次前端源码中发现直接访问 SQLite、SecureStore 或 Git adapter 的实现。领域规则与平台适配分层有实际价值。
3. **服务生命周期独立于单个页面。** [bootstrap](../src/bootstrap/index.ts) 缓存服务实例，浏览配置不等于停止任务；facade 明确投影方法并处理公开错误。
4. **共享组件确实被多个页面使用。** [primitives](../src/shared/ui/primitives.tsx)、[forms](../src/shared/ui/forms.tsx)、[selection](../src/shared/ui/selection.tsx)、[git-status](../src/shared/ui/git-status.tsx) 统一了较多基础语义。
5. **已有编辑并发保护。** 编辑器 identity、revision、保存期间继续输入保留、旧查询作用域过滤都有真实实现，并有 E2E 覆盖。不能把它描述成一个完全没有竞态意识的原型。
6. **长对话已有虚拟化和分页。** Conversation 使用 FlatList；历史详情按可见性加载，轨迹、正文和最终回答有分页/展开机制。
7. **Markdown 预览有明确安全边界。** 不执行 HTML，不自动加载远程图片，相对图片路径经过受控解析。下文指出的是显示正确性问题。
8. **验证内容超出纯渲染测试。** 现有测试覆盖项目切换、未保存保护、保存竞态、协议流程、任务并发、提案和恢复等有意义的行为。

## 4. 问题总表

“复现”表示本次在隔离浏览器观察到；“源码确认”表示控制流/依赖直接可证；“规模风险”表示实现存在明确放大机制，但尚未测量原生性能后果。

| ID  | 级别 | 问题                                                | 证据类型                     |
| --- | ---- | --------------------------------------------------- | ---------------------------- |
| F01 | P1   | 组合输入状态下的回车触发发送                        | 复现 + 源码                  |
| F02 | P1   | 删除失败后未恢复未保存保护，返回丢失编辑            | 复现 + 对照 + 源码           |
| F03 | P1   | 三个配置列表在初始化失败时无限加载且不显示错误      | 复现 + 源码                  |
| F04 | P2   | 直接进入/刷新配置页不恢复已保存主题                 | 复现 + 源码                  |
| F05 | P2   | 未闭合 Markdown 标记导致实际文字被截掉              | 复现 + 源码                  |
| F06 | P2   | 先截断后做 diff，长文件尾部修改无法审阅             | 复现 + 源码                  |
| F07 | P2   | 多个操作弹层不在当前弹层内展示失败信息              | 复现 + 源码                  |
| F08 | P2   | 浅色主题多组小字号文字对比度不足                    | 公式计算 + 使用位置          |
| F09 | P2   | 项目/对话及部分轨迹操作不满足项目约定的 44px 热区   | 实测 + 源码                  |
| F10 | P2   | 长按菜单和 tab 语义缺少完整键盘操作                 | 复现 + 源码                  |
| F11 | P2   | 文件树、图片预览和部分目录缺少规模控制              | 源码确认的规模风险           |
| F12 | P2   | 每个字符整份持久化会话状态，放大写入和刷新成本      | 写入计数 + 源码              |
| F13 | P2   | 工作台控制器过大，能力拆分主要停留在输出层          | AST 统计 + 源码              |
| F14 | P2   | 配置控制逻辑重复，跨 feature 组件耦合工作台内部类型 | 源码确认                     |
| F15 | P2   | 架构约束未完整编码进 ESLint                         | lint 探针 + 源码             |
| F16 | P2   | 前端质量门禁与视觉/异常场景覆盖存在缺口             | 实际测试结果 + 配置/用例审阅 |
| F17 | P3   | 设计 token 和文本尺度的复用范围仍偏窄               | 源码确认                     |

## 5. 需要优先修复的问题

### F01 · P1 · 组合输入的回车会直接发送任务

**位置：** [conversation.tsx](../src/features/workbench/conversation.tsx) 第 406–415 行。

`onKeyPress` 只检查 Web、Enter 和 Shift，没有检查原生事件的 `isComposing` 或输入法兼容状态。当前 react-native-web 的 TextInput 会先调用传入的 `onKeyPress`，之后才在自身默认提交逻辑中处理 composition；底层保护不能覆盖这里的自定义发送。

本次给输入框写入 `nihao`，发送 `compositionstart`，随后派发 `key=Enter / keyCode=13 / isComposing=true`。结果创建了 1 个任务，输入被清空。证据见 [记录](frontend-audit-2026-10-16-evidence/results.json) 和 [截图](frontend-audit-2026-10-16-evidence/ime-submitted.png)。

**影响：** 输入法确认候选词的动作可能被当作“发送”，提前提交未完成目标。远程模式下有产生非预期请求和工具操作的风险；本次只在演示模式复现，没有发起真实远程请求。不同输入法还可能报告 `keyCode=229`，不能只针对本次事件形态修复。

**建议：** 在自定义发送入口识别组合输入；必要时追踪 composition 生命周期，并同时处理原生事件标记和 229 兼容情形。只在确认不是组合输入、不是重复按键且可以发送时执行命令。

**验收：** 组合输入确认不发送；组合输入结束后的独立 Enter 恰好发送一次；Shift+Enter 换行；普通键盘发送保持正常。至少覆盖 Chrome 常见事件形态，再补实际中文输入法验证。

### F02 · P1 · 删除失败后，未保存保护不再拦截返回

**位置：** [forms.tsx](../src/shared/ui/forms.tsx) 第 19–33 行；[skills/editor.tsx](../src/features/skills/editor.tsx) 第 476–482 行；[mcp/server.tsx](../src/features/mcp/server.tsx) 第 446–452 行。

`useDraftGuard.allow()` 把 `allowed` 设为 true，并执行后续动作，但没有失败后撤回放行的路径。技能和 MCP 删除页面在实际异步删除开始前调用 `guard.allow()`。当删除失败、页面仍保留时，`usePreventRemove(dirty && !allowed, ...)` 已失效。

本次复现步骤：

1. 新建技能，保存，再修改正文，使编辑器存在未保存内容。
2. 在隔离页面给 `operation_headers` 写入注入失败。
3. 确认删除，收到“技能删除未完成，请重新打开应用恢复”。
4. 关闭删除弹层，执行浏览器返回。
5. 页面返回 `/skills`，编辑器消失，未保存保护未出现。

对照路径中，仅修改 Agent 设置再执行浏览器返回，保护弹层正常出现、编辑器仍在。因此不能把本次问题归因于所有浏览器返回都不受保护。

**影响：** 删除操作没有成功，但失败处理改变了后续导航安全状态，用户可能丢失当前编辑。浏览器行为已验证；原生系统返回有相同控制状态风险，仍需原生回归。

**建议：** 异步操作成功后才对实际导航放行；对确实需要提前放行的路径，应把放行设计成一次性状态，并在失败时复位。不要让一个用于导航确认的方法同时包裹可能失败的业务动作。

**验收：** 注入删除冲突、存储失败后，页面仍 dirty，浏览器返回/系统返回继续提示；取消确认保留内容；只有删除成功或明确放弃后离开。技能和 MCP 两条调用链都覆盖。

### F03 · P1 · 配置初始化失败后，只剩加载动画

**位置：** [model-config/list.tsx](../src/features/model-config/list.tsx) 第 46–49、91 行；[mcp/index.tsx](../src/features/mcp/index.tsx) 第 40–43、97 行；[skills/index.tsx](../src/features/skills/index.tsx) 第 30–33、133–137 行。

三个 hook 都会记录初始化错误，但列表页把错误放在 `runtime` 存在的分支内。服务初始化失败时 `runtime` 始终不存在，用户只能看到 Loading。Agent 设置和若干编辑页反而能显示错误，说明全局失败状态契约没有统一。

本次使隔离 context 的 `indexedDB.open` 抛错，分别直达三个路由；它们都只显示标题和 1 个进度条，错误文字不存在。直达 Agent 设置的对照页面可以显示“本地资料读取失败”。截图见 [模型](frontend-audit-2026-10-16-evidence/startup--models.png)、[MCP](frontend-audit-2026-10-16-evidence/startup--mcp.png)、[技能](frontend-audit-2026-10-16-evidence/startup--skills.png)。

**影响：** 启动失败被误呈现为仍在加载，缺少可操作恢复入口；直接访问配置页时尤其明显。

**建议：** 使用明确的 loading/ready/error 状态，失败时结束加载并显示可访问的错误和重试/返回入口。DATA_FORMAT 应引导到已有受控开发数据重建流程，普通 STORAGE 错误不能被当成重建授权。

**验收：** 三个列表及所有编辑页在初始化拒绝时展示错误，spinner 不再常驻；重试成功能进入内容；保留已有数据。

## 6. 正确性与全局反馈

### F04 · P2 · 已保存主题仅在工作台初始化时恢复

**位置：** [use-workbench-data.ts](../src/features/workbench/use-workbench-data.ts) 第 235–247 行；[theme.ts](../src/shared/theme.ts) 第 63–67 行；[app/_layout.tsx](../src/app/_layout.tsx)；[workbench-state.ts](../src/shared/workbench-state.ts) 第 19–22 行。

主题从 Zustand 默认的 `system` 开始，持久化外观的读取却放在工作台专用 hook 内。配置页调用 `useAppServices` 或各自配置 hook，不执行这段恢复逻辑。

**复现：** 系统设为浅色，在工作台保存深色外观，再完整导航到 `/settings/agent`。IndexedDB 中仍为 `appearance: dark`，页面却是 `config-light`，`config-dark` 数量为 0。

**建议：** 在 app 级初始化/主题 provider 中恢复外观，所有路由共享该就绪状态；避免依赖某个业务首页先挂载。主题读取失败也应有一致的默认与反馈策略。

**验收：** 刷新或直达所有配置路由均保留已选外观；跟随系统仍能响应系统切换；不会由未就绪的默认值覆盖已保存偏好。

### F05 · P2 · Markdown 的未闭合标记会吞掉文字

**位置：** [markdown.tsx](../src/features/workbench/markdown.tsx) 第 13–25 行。

分词正则只提取完整的粗体/代码片段，但渲染判断仅使用 `startsWith('**')` 或 ``startsWith('`')``。未匹配的普通片段如果恰好以这些字符开头，也会执行 `slice(2, -2)` / `slice(1, -1)`。

**复现：** 文档输入 `**尚未闭合` 和 `` `尚未闭合 ``，保存后阅读分别只剩“尚未”和“尚未闭”。[截图](frontend-audit-2026-10-16-evidence/markdown-unclosed.png) 可见实际正文字符被省略。

**影响：** 阅读器展示不忠实；流式输出经过同一渲染器时，尚未闭合的 Markdown 也会错误显示。底层文件未被改写，不能把它称为文件存储丢失。

**建议：** 让 tokenizer 返回明确的 token 类型，只有完整匹配的 token 才移除定界符；未闭合片段按原文展示。无需为此引入 HTML 渲染或放宽图片安全边界。

**验收：** 未闭合、孤立标记、空 token、普通文本中的反引号及流式逐步闭合都不吞字。链接、表格、嵌套列表等尚未支持的 Markdown 语法另行说明能力边界，不与本缺陷混为一谈。

### F06 · P2 · 先截断再计算 diff，无法检查真正的尾部变化

**位置：** [review.tsx](../src/features/workbench/review.tsx) 第 28–46、248–251 行。

当前执行 `diffLines(before.slice(0, 12000), after.slice(0, 12000))`。当两份文件前 12,000 字符相同、修改在后面时，界面只能展示相同内容，实际增删不会出现。

本次构造 12,150 字符相同前缀，再把尾部“旧尾部”改为“新尾部”。未暂存差异中两个尾部都不存在。界面确实提供截断提示，故这里没有指控“偷偷隐藏截断”；问题是审阅入口缺乏查看剩余差异的能力。

**建议：** 在受控资源预算内计算真实差异，再按 hunk 分页/限制上下文；大文件可交由业务层返回有边界的 diff DTO。截断时应显示尚有多少未审阅内容，并提供继续查看，不以“打开当前文件”替代历史前后对比。

**验收：** 前缀相同、仅尾部变化的长文件能定位真实修改；历史删除内容仍可查看；超限文件有明确降级方式，界面不会长时间阻塞。

### F07 · P2 · 错误不属于当前操作弹层

**位置：** [skills/editor.tsx](../src/features/skills/editor.tsx) 第 145–155、466–490 行；[skills/index.tsx](../src/features/skills/index.tsx) 第 133–159 行；[mcp/unknown.tsx](../src/features/mcp/unknown.tsx) 第 65–69、71–102 行；[workbench/sheets.tsx](../src/features/workbench/sheets.tsx) 第 121–166 行。

技能删除、技能包安装、未知回执确认等失败时，error 写在底层页面，当前 Sheet 没有呈现该错误。参考资料导入弹层也没有自己的错误区域。部分重命名/确认弹层正确展示 error，形成不一致。

本次删除失败后，活动 `role=dialog` 的文字只包含标题、说明和“确认删除技能”，不包含真实失败信息。[补充记录](frontend-audit-2026-10-16-evidence/supplementary-failed-skill.json) 与 [截图](frontend-audit-2026-10-16-evidence/failed-delete-modal.png) 可核对。底层页面存在错误文字，不等于处于 modal 中的用户能够正确获取反馈。

**建议：** 操作的 pending/error/success 随发起操作的表单或 dialog 展示；统一弹层错误区域与可访问播报。业务错误不要统一写入一个被遮挡的全局字符串。

**验收：** 在安装、删除、导入、恢复、确认回执的失败点注入错误，当前活动 dialog 内能读到原因，按钮恢复可重试，关闭后草稿保留。

## 7. 可访问性与交互一致性

### F08 · P2 · 浅色主题部分文本对比度不足

**位置：** [theme.ts](../src/shared/theme.ts) 第 3–29 行；[conversation.tsx](../src/features/workbench/conversation.tsx) 第 137–142 行；[git-status.tsx](../src/shared/ui/git-status.tsx) 第 10–30 行；[screen.tsx](../src/features/workbench/screen.tsx) 第 433–445 行。

按当前 token 的实际颜色计算：

| 前景 / 背景                               | 对比度 | 普通小字号文本 AA 参考值 |
| ----------------------------------------- | -----: | -----------------------: |
| muted `#788397` / surface `#FFFFFF`       | 3.82:1 |                    4.5:1 |
| muted `#788397` / background `#F7F8FC`    | 3.60:1 |                    4.5:1 |
| warning `#A17131` / warningSoft `#FBF3E6` | 3.87:1 |                    4.5:1 |
| danger `#C04753` / dangerSoft `#FCEEF0`   | 4.36:1 |                    4.5:1 |
| secondary `#687286` / surface `#FFFFFF`   | 4.84:1 |              4.5:1，达到 |

这些不足的组合实际用于 10–14px 的时间、状态、错误等文字，不能套用大字号文字的 3:1 门槛。disabled 控件、纯装饰图标和占位符的特殊情况应分别评估；本问题的重点是正常可读内容。

**建议：** 调整语义色的可读文本变体，检查所有实际前景/背景组合，避免只修改一个页面。warning/danger 的文字与图标也可分开定义颜色。

**验收：** 正常小字号文字达到 4.5:1；深浅两主题都自动校验；不能靠隐藏重要说明或统一加粗来规避。

### F09 · P2 · 44px 热区约定未落实到全部操作

**位置：** [project-tree.tsx](../src/features/workbench/project-tree.tsx) 第 118–125、191–203 行；[trace.tsx](../src/features/workbench/trace.tsx) 第 143–148、480–498 行。

项目规定的 `workbenchMetrics.touch = 44` 并未覆盖所有操作。390px 视口中实际测得项目行高 36px、对话行高 34px；这两处 Pressable 没有 hitSlop。推理展开为 34px，子任务停止/提案入口也仅有少量垂直 padding。

共享 IconButton 的小尺寸已经通过 hitSlop 补偿，这是正确实现；不能据此认为页面自写 Pressable 也自动获得相同保护。

**建议：** 将“紧凑视觉尺寸”和“可点击尺寸”分开定义，复用有热区契约的行/动作组件，检查相邻点击区域重叠。44px 是本项目约定，不把它描述为所有 Web 标准的唯一合规门槛。

**验收：** 项目树、轨迹和子任务动作均满足项目热区要求；原生实际点击边界复核；大字体和密集相邻操作仍清晰。

### F10 · P2 · 桌面键盘操作不完整

**位置：** [project-tree.tsx](../src/features/workbench/project-tree.tsx) 第 173–190 行；[selection.tsx](../src/shared/ui/selection.tsx) 第 30–77 行。

对话管理菜单只能由 `onLongPress` 或原生 accessibility action 打开。Web 键盘没有对应的菜单键/Shift+F10/contextmenu 处理，也没有常规可聚焦的管理按钮。当前会话可以通过顶栏改名，但这不能替代对其他会话的归档管理入口。

ViewTabs 声明 `tablist/tab` 和 selected 状态，却没有方向键、Home/End、焦点管理等配套行为。本次焦点在“全部”时按 ArrowRight，选中项仍是“全部”；Shift+F10 也没有打开对话管理菜单。

**建议：** 为长按操作提供键盘等价入口；Web tabs 使用 roving tabIndex 并处理方向键，明确自动激活或手动激活策略；保持原生读屏语义。

**验收：** 只用键盘可以管理非当前会话和归档；tabs 可以按约定用方向键移动并激活；焦点可见，打开/关闭菜单后焦点位置可预测。原生屏幕阅读器另作验证。

## 8. 性能与状态流

### F11 · P2 · 全量目录与原图缩略图缺少规模边界

**位置：** [files.tsx](../src/features/workbench/files.tsx) 第 14–35、138–178、198–244 行；[project-tree.tsx](../src/features/workbench/project-tree.tsx) 第 75–99、168–269 行；[history.tsx](../src/features/workbench/history.tsx) 第 111–120、171–211 行；[editor.tsx](../src/features/workbench/editor.tsx) 第 32–42 行。

文件树和图片网格在 ScrollView 中全量 map，没有可见性加载；每个已挂载图片行都调用完整 `preview()`，将原图 data URI 保存在组件状态中。项目树同样全量投影全部项目/会话，Git 历史每次加载后继续把所有行留在滚动容器中。

此外，Markdown 的 `loadImage` 依赖所有图片 path/revision 拼成的字符串；任意一张图片改变都会改变加载函数身份，使已显示的其他图片也重新执行加载。

**影响口径：** 可以确认挂载数量和原图读取会随目录规模增长；本次没有原生堆内存、长任务或掉帧实测，不能断言某个文件数一定会崩溃。单文件允许达到 20MB，使原图缩略图策略值得优先评估。

**建议：** 文件树先投影为当前展开的扁平行，再用虚拟列表；图片在可见范围加载，并以 project/path/revision 为键缓存受限尺寸缩略图，限定并发和缓存预算。将每张 Markdown 图片的失效范围收敛到对应资源。不要为了虚拟化破坏当前目录状态或横向差异滚动。

**验收：** 建立合成规模集，如数百/数千文本文件、较多高分辨率图片、较多会话，记录实际挂载行数、预览读取次数、内存与交互延迟；一张图片改变不导致所有无关图片重载。最终阈值以目标原生设备测量确定。

### F12 · P2 · 草稿按字符写入整份会话状态

**位置：** [use-draft.ts](../src/features/conversations/use-draft.ts) 第 40–64 行；[conversations/service.ts](../src/application/conversations/service.ts) 的 `saveDraft`、`persist`；[use-workbench-data.ts](../src/features/workbench/use-workbench-data.ts) 第 304–305 行；[use-workbench.ts](../src/features/workbench/use-workbench.ts) 第 19 行。

每次 onChange 都立即调用 saveDraft。服务在串行队列中克隆整个 ConversationState，把它整体写入 `conversations/state`，再发布整个快照。工作台订阅全部会话状态，根 hook 又订阅整个 Zustand store。

本次正常逐键输入 20 个字符，观察到 **20 次 `conversations/state` 持久化写入**。未发现批量合并。结合整份状态 clone/freeze/写入，成本同时随输入频率和会话总量增长。切换对话前的 flush 是必要保障，不能为了减少写入而删除。

**建议：** 优先按会话保存业务记录，并合并尚未派发的同会话写入；保留最后一份已确认草稿及 flush 屏障。如果采用 debounce，应明确进程终止前未落盘窗口的产品取舍，不能无条件声称“无损优化”。缩小订阅选择范围，避免输入导致无关目录和设置状态更新。

**验收：** 高频输入时待写队列有界，旧回执不覆盖新输入；切换/发送前 flush 等待正确；故障后可重试；在较多会话的实例记录输入延迟和写入量。

## 9. 结构、组件复用与可维护性

### F13 · P2 · 能力对象拆了，控制器职责没有充分拆

**位置：** [use-workbench.ts](../src/features/workbench/use-workbench.ts) 第 18–562、572–597、600–934 行。

该文件包含会话管理、项目创建、任务提交、路由跳转、编辑保护、错误/notice、提案预览、全局 busy，以及六组能力投影。后半段用大量手写 memo 对象和依赖数组包装前半段，再用 CommandBindings 反射枚举函数保持稳定身份。

| 输出能力     | 字段数 |
| ------------ | -----: |
| conversation |     32 |
| editor       |     17 |
| files        |     11 |
| git          |     21 |
| runs         |      5 |
| dialogs      |     52 |

这比把整个 state 直接传给所有组件好，但 dialogs 已同时承担页面、项目树、设置、启动错误、任务摘要和弹层等多个职责。每次业务扩展仍需修改中央控制器、返回对象、能力投影及依赖数组。字段数和文件长度只是辅助证据，真正问题是变更影响面过大。

**建议：** 保留已有 editor/git actions，把会话命令、任务提交和项目导航进一步按真实用例内聚；将页面壳层状态与表单弹层状态分开；ProjectTree、Settings、Header 获取明确且较窄的 props。让来源 hook 提供稳定命令，逐步减少反射桥接和重复列举。不要为每个按钮制造空壳 hook，也不要求机械限制文件为某个固定行数。

**验收：** 修改会话归档流程不需要改无关文件/Git/设置能力映射；组件 props 能明确表达依赖；保留现有旧查询过滤、保存并发和跨项目切换测试。

### F14 · P2 · 重复控制逻辑与跨 feature 耦合同时存在

**位置：** [model-config/common.tsx](../src/features/model-config/common.tsx) 第 10–48 行；[mcp/common.ts](../src/features/mcp/common.ts) 第 7–47 行；[skills/common.ts](../src/features/skills/common.ts) 第 9–57 行；[skills/picker.tsx](../src/features/skills/picker.tsx) 第 2、10–17 行；[model-config/picker.tsx](../src/features/model-config/picker.tsx) 第 79–121 行。

三个配置 hook 重复了服务初始化、getSnapshot/subscribe、working ref、busy、error 和 action 包装，仅业务 API、额外项目读取和错误处理略有不同。F03 的失败分支差异已经说明重复逻辑会产生行为漂移。

另一方面，Skills 内的 SkillPicker 直接接受工作台的 DialogsCapability / ConversationCapability，不能脱离中央工作台类型独立维护。ModelPicker 则重新实现 Modal、遮罩、键盘避让、安全区和顶栏，虽然它需要虚拟列表、不能简单塞进现有 Sheet 的 ScrollView，但公共外壳仍可共享。

**建议：** 提取已有多调用方需要的服务就绪状态、订阅和异步 action 约定；业务 hook 继续保留自己的查询和命令。SkillPicker 改接收 projectId、prompt、onChoose/onClose 等实际所需输入。将弹层框架与可滚动内容分开，使普通 Sheet 和虚拟列表选择器共用外壳。

**验收：** 同类初始化错误和 busy 处理只维护一套规则；Skills 不再导入 workbench 的内部 controller 类型；模型选择器仍保留 FlatList，而非换成全量 ScrollView。

### F15 · P2 · 架构规则不能落实所有明确约束

**位置：** [architecture-rule.cjs](../scripts/architecture-rule.cjs) 第 17–18、33–38 行；[architecture-boundaries.test.ts](../tests/architecture-boundaries.test.ts)。

features 分支只禁止解析到 `adapters` 的内部依赖，没有阻止直接导入数据库、凭证、文件系统或 Git 库。shared 的检查仅覆盖 `shared/ui` 与 theme，其他 shared 文件不受该规则保护，app 路由也不在此规则检查范围。

本次使用 ESLint.lintText 进行不落盘探针，以下依赖的 `architecture/boundaries` 错误数均为 0：

```typescript
// 假设位于 src/features/audit-boundary.ts
import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';

// 假设位于 src/shared/audit-boundary.ts
import { WorkbenchScreen } from '@/features/workbench/screen';
```

**性质：** 这是防止未来回归的规则缺口；本次没有发现上述数据库/凭证直连已经出现在产品前端。docs/design.md 已承认部分规则不完整，但 AGENTS.md 要求分层限制由 ESLint 验证，仍需补齐。

**建议：** 明确 UI 层允许的业务入口，禁止确定不应直接访问的平台存储/Git 包；允许正常 UI 所需的 React Native、expo-image 等依赖。为 shared 全目录和路由职责建立适用规则，保留 bootstrap 获取服务的明确例外。

**验收：** 现有允许案例继续通过；新增数据库、凭证、文件系统、Git 直连和 shared 反向依赖拒绝案例；静态/动态/类型导入均受约束。

### F17 · P3 · 设计尺度仍依赖页面手写

**位置：** [theme.ts](../src/shared/theme.ts) 第 54–61 行；[primitives.tsx](../src/shared/ui/primitives.tsx)；[markdown.tsx](../src/features/workbench/markdown.tsx)；[run-activity.tsx](../src/features/workbench/run-activity.tsx)。

颜色复用较好，但字号、行高、间距、圆角仍以页面数值为主。现有 metrics 只在少数文件使用；活动任务状态出现 9px 字号，其他辅助信息多为 10–12px。代码字体也有平台选择与直接 monospace 的多种路径。

**建议：** 根据已有页面提取少量明确的文字角色、间距和圆角规则；优先统一有重复语义的行、状态、表单反馈。无需把每一个数字都变成 token，也无需创建大量无行为包装组件。

**验收：** 同语义文本/状态可从一个维护入口调整；辅助文字在目标手机和系统字体放大场景可读；仍保持当前紧凑工具风格。

## 10. 测试与验证体系

### F16 · P2 · 现有检查不能完整构成前端质量门禁

**位置：** [package.json](../package.json) 第 57–65 行；[playwright.config.ts](../playwright.config.ts) 第 14–18 行；[ui-consistency.spec.ts](../tests/e2e/ui-consistency.spec.ts)；[vitest.config.ts](../vitest.config.ts)。

本次全部现有检查通过而额外场景仍发现缺陷，具体缺口包括：

1. `npm run check` 不包含 Web 导出、Playwright 或格式检查；`test:e2e` 又不自动构建。手动运行 E2E 时可能验证旧导出目录。现有文档说明了先构建，但命令本身没有保证这一点。本次已经先构建，结果不受此问题影响。
2. 仓库根没有 `.github` 工作流目录；未发现仓库内持续集成配置能保证前端必要检查执行。不能据此推断外部 CI 一定不存在。
3. 截图调用主要是保存文件，没有 `toHaveScreenshot` 视觉基线断言。新的一致性测试也只在部分位置断言颜色/尺寸，不等于对整体视觉一致性自动验收。
4. 个别截图时机没有等到页面就绪。当前 `unified-onboarding-dark.png` 实际截到了配置页 spinner；[留存图](frontend-audit-2026-10-16-evidence/existing-e2e-dark-onboarding.png) 不足以证明深色首次配置内容正确。
5. 缺少本次确认的组合输入、删除失败后的导航保护、配置初始化失败、主题直达、未闭合 Markdown、长文件尾部差异，以及键盘语义的针对性回归。
6. 原生脚本已经存在，但本次未执行；Web 短视口不模拟真实软键盘、系统返回和字体缩放，不能据此给出原生验收结论。

**建议：** 保持快速 `check` 的职责明确，另设能先导出再 E2E 的前端门禁入口并接入实际 CI。新增行为测试应围绕本次缺陷的失败条件；视觉基线只覆盖稳定关键页面，等待应用就绪并固定主题/字体/视口。补目标 Android/iOS 的键盘、返回和可访问性回归。

**验收：** 从源码修改到质量门禁可以复现运行；不会悄悄测旧 bundle；本次已确认缺陷都有能在修复前失败、修复后通过的测试。不要以增加大量仅检查实现细节的单元测试替代交互验证。

## 11. 建议的组件与职责调整

这部分是对当前问题的落地建议，不要求重建整个前端架构。

| 现有部分                                                      | 建议                                    | 原因                                                |
| ------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- |
| T / Button / Field / Toolbar / ToolbarAction / GitStatusBadge | 保留并补足契约                          | 已有多处真实使用，适合统一可读性、busy 与反馈规则。 |
| ViewTabs / SegmentedControl                                   | 保留，补键盘和可访问交互                | 视觉复用有效，语义行为仍不完整。                    |
| ConfigPage / FormScroll / Section                             | 保留                                    | 页面外壳基本统一，不应回退为页面各写一套。          |
| Sheet 与 ModelPicker 的 Modal 外壳                            | 共享可组合外壳，分别选择滚动容器        | 统一关闭、安全区、标题、错误；避免嵌套虚拟列表。    |
| model/mcp/skills 配置 hooks                                   | 复用就绪/订阅/action 机制，保留业务逻辑 | 去掉真实重复，避免业务配置抽象成难懂的万能 schema。 |
| useWorkbench                                                  | 按会话、任务提交、项目导航收敛职责      | 输出六个大对象不足以消除中央控制器耦合。            |
| ProjectTree / Settings / Header                               | 使用窄 props                            | 不应为一个简单动作接收 52 字段 dialogs 能力。       |
| SkillPicker                                                   | 使用独立输入和回调                      | 移除 Skills 对 workbench 内部类型的反向依赖。       |
| Markdown tokenizer / diff 投影                                | 拆出纯逻辑并做行为测试                  | 这两处已经有显示正确性缺陷，适合独立验证。          |
| 文件/图片列表                                                 | 基于规模引入虚拟化和资源预算            | 当前全量挂载、原图预览不能只靠 memo 解决。          |

不建议一开始引入新的全局业务状态库、保留平行旧实现、建立兼容别名，或一次性重写所有页面。当前 AppServices 与领域边界应继续保留，整改时同步更新相关稳定技术文档和实际验证。

## 12. 整改顺序与完成标准

### 第一批：保护用户动作与编辑内容

处理 F01、F02、F03、F07，分别补组合输入、删除失败导航、初始化失败和活动弹层错误的回归。此批不依赖大规模组件重构。

完成标准：非预期 Enter 不发送；失败不改变离开保护；初始化拒绝有明确反馈；当前操作的错误在当前界面可见。

### 第二批：修正显示正确性与基础交互

处理 F04、F05、F06、F08、F09、F10。覆盖直达路由主题、Markdown 部分输入、长文件真实差异、两主题颜色组合、手机热区与 Web 键盘。

完成标准：相同业务状态在不同路由/入口展示一致；可见内容忠实于原始资料；重要状态可读，操作有完整替代输入方式。

### 第三批：缩小变更影响面并验证规模

处理 F11–F16，并根据实际页面需要完成 F17。先收集规模 fixture 的查询、挂载、写入和交互指标，再选择虚拟化、缓存和存储粒度的改动。

完成标准：组件依赖可读、中央 hook 不再承担所有流程；同类失败处理只有一个维护入口；性能成本有界且有目标设备证据；架构禁令和前端门禁能自动阻止回归。

**最终建议：以第一、二批的缺陷关闭作为前端质量达标的前置条件；第三批按规模验证结果安排。当前已有分层、共享组件和行为测试值得继续演进，无需推倒重写。**
