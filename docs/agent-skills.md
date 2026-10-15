# Agent Skills 包、版本与运行加载

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                  |
| -------- | ------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| 1.0.0    | 2026-10-15T17:24:30+08:00 | 9ad009be8a41df28a02060c5620ee12a29c3d901 | 建立技能包格式、验证限制、Git 版本、授权与加载/恢复契约。 |

## 1. 技能的作用

Skill 是用户安装并按项目启用的流程资料，由根目录 SKILL.md、可选参考文字、图片和其他资源组成。Agent 先看到目录摘要，匹配任务时按需读取说明与资源。技能不是可执行插件，也不创建新的本地/MCP 权限。

当前支持管理、Markdown/ZIP 导入、正文与资源编辑、版本列表、从版本读取包、导出和运行版本冻结。包含脚本的包可以安装并阅读，脚本不执行；allowed-tools 只作说明。技能格式可表达环境需求，但宿主不会自动安装运行环境。

## 2. 包结构与最小示例

```text
writing-review/
  SKILL.md
  references/style.md
  assets/example.png
```

根 SKILL.md 示例：

```md
---
name: writing-review
description: 按给定风格审阅文稿并提出修改建议。
compatibility: 需要工作区文本读取能力。
allowed-tools: read_text search_text write_text
metadata:
  author: local
---

先读取用户选定资料，再检查结构、术语和引用。
必要时读取 references/style.md。
将建议保存到用户指定路径；本技能不授予额外提交或网络权限。
```

frontmatter 必须从文档开头开始，支持 BOM/CRLF 规范化，YAML 内容最多 8 KiB。name/description 必须是字符串；正文不能为空。optional license、compatibility、allowed-tools 为字符串，metadata 为字符串键值映射。

name 为 1–64 位小写字母、数字和单连字符，不能有连续/首尾连字符；description 为非空且最多 1,024 字符，compatibility 为非空且最多 500 字符。YAML 禁止重复键、别名扩展和 merge，解析出现 warnings/errors 会拒绝。

## 3. 路径与导入

skillPath 在工作区 safePath 上进一步拒绝隐藏目录、node_modules、prototype 特殊名称、数据库和 `.key/.pem/.p12/.pfx` 等凭证后缀。路径须规范化，包内大小写重复文件拒绝；不要将整个带 `.git`/依赖/凭证的目录直接打包。

单个 `.md` 输入被当作仅含 SKILL.md 的包。ZIP 可在根目录放一份 SKILL.md，也可含多个独立技能目录；不允许技能根互相嵌套或同名技能。目录名与 frontmatter name 不一致时按 name 整理并提示。

ZIP 处理先验证目录，再以受限分块解压检查实际输出量，不能只信声明大小。拒绝绝对路径、`..`、反斜杠、盘符、重复路径、损坏/加密/不支持格式；隐藏文件、依赖和 `__MACOSX` 等导入项可跳过并显示警告，正常 bundle 则直接拒绝受保护路径。

## 4. 容量限制

来源：[skillLimits](../src/core/skills/rules.ts)。

| 项目                   | 当前限制                               |
| ---------------------- | -------------------------------------- |
| 安装技能 / 单项目启用  | 128 / 64                               |
| ZIP 输入与展开总大小   | 20 MiB                                 |
| 单包文件 / ZIP 项目数  | 512                                    |
| 整个库技能资源         | 4,096                                  |
| SKILL.md               | 64 KiB                                 |
| 图片                   | 4 MiB，同时验证 PNG/JPEG/WebP 头与尺寸 |
| 其他单文件             | 1 MiB                                  |
| 单运行累计加载技能正文 | 120,000 UTF-16 单位                    |

text 资源要求有效 UTF-8 且无空字符，按 decode→encode roundtrip 检查。图片受工作区图片尺寸边界约束。二进制可保存/导出，当前不给模型读取。

正文累计上限只针对完整 SKILL.md 激活内容，不能把它解释为整个运行所有资源的总字数；资源请求还受工具、模型请求、预算和单文件限制。

## 5. 独立 Git 库与内容版本

[GitSkillRepository](../src/adapters/skills/repository.ts) 使用内部项目 `agent-skills-library`，路径 `skills/<name>/...`，元数据 bucket 为 skill-projects，日志 namespace 为 skills。它不是用户当前项目，也不把技能文件复制进每个项目。

库 commit 是整库 HEAD；skill revision 是该技能路径与各 blob revision 规范排序后得到的内容指纹。另一个技能更新造成库 commit 变化时，未改变的技能 revision 可以保持相同。

安装/更新是整包替换：新包遗漏的旧资源会被删除，不是只追加新文件。install/remove 使用 expectedCommit 拒绝过期预览。Repository 再次验证完整 bundle、路径冲突、库资源数量，UI 校验不是唯一防线。

技能保存使用 skills 专用 files_commit：文件变化、index 变化、固定提交目标和日志回执收束为一次库版本。它是“保存版本化技能”的显式用例，与用户项目普通保存不自动公开 commit 的语义不同。

versions 默认 30、最大 100 条，沿库历史过滤当前技能内容变化，跳过没有该技能或内容重复的提交。游标携带 name、前一内容 revision 和 Git 历史游标，不可换技能复用。

## 6. 项目授权与运行冻结

grants 绑定 projectId + name + skill revision。技能内容改变会使旧授权失效；库 reconcile 清除不再匹配的 grants，需用户查看后重新启用。只改其他技能时不撤销本技能授权。

运行准备 capture 已启用版本，保存 commit、revision、摘要与资源列表。更新/删除库的最新版不改变已启动 Run 读取的历史版本。子 Agent 继承相同 Skills 快照，使用独立加载集合，不共享可变激活状态。

用户目标中的 `$writing-review` 可明确调用；未在当前项目启用或不存在时准备失败、保留草稿，不自动安装或授权。普通文本名称匹配可由 Agent 决定按需加载，但只能选已授权目录。

## 7. 加载与工具语义

```mermaid
flowchart LR
    C[项目启用版本] --> S[启动 capture 固定 commit / revision]
    S --> D[系统提示词加入目录摘要]
    D --> L[load_skill: 完整 SKILL.md]
    L --> R[read_skill_resource: 固定版本资源]
```

- **load_skill**：读取完整正文和资源目录，记录 activation 的 name/revision/source/at。重复加载返回 alreadyLoaded，不重复占用激活字符预算。
- **明确 `$name`**：根任务执行前直接加载正文，加入系统上下文并产生 explicit 加载轨迹。
- **read_skill_resource**：必须先加载技能，路径相对技能根；文字按 offset/length 分段并返回 truncated/nextOffset，图片仅在模型允许时转发。
- **读取 SKILL.md**：返回已加载提示，避免把正文重复塞进上下文。
- **binary**：明确拒绝交给模型，管理界面可导出。

资源是固定版本的只读资料，不是项目写权限。脚本内容被读到不意味着可执行，技能说“提交”或“联网”仍需原用户目标和现有工具授权。

## 8. 恢复与失败屏障

Skills 与 Git/业务库之间无跨存储事务。库操作日志先按 skills namespace 恢复，再读取 Git HEAD 重建 summaries/issues/grants。若 Git 已保存而配置回执失败，启动 reconcile 使当前状态重新与实际库版本一致。

SkillService 开始库变更时置 unsettled。效果可能已发生的异常会阻断后续变更/新 capture，提示重开；明确 VALIDATION/CONFLICT/LIMIT 且 repository 不需要恢复时可解除临时屏障。

库某项 SKILL.md/资源无效时加入 issues 并不加入可用目录。必要 Git 恢复失败时禁止继续库写入，已有已提交版本可能仍能查询；不能清空库以掩盖回执故障。

## 9. 导出与隐私

导出按明确 commit 读取包，通过 fflate 打包为 `name/...` 结构，走平台下载/分享。安装包和资源可能包含用户私有资料；导出不会自动删除敏感内容，也不自动上传市场或远端服务。

当前没有在线技能市场、依赖解析、脚本沙箱、自动更新或跨设备同步。不应为这些未实现能力保留占位 registry/runner 目录。

## 10. 源码与验证

[包解析](../src/adapters/skills/package.ts)、[版本库](../src/adapters/skills/repository.ts)、[运行读取](../src/adapters/skills/run.ts)、[服务](../src/application/skills/library.ts)、[工具](../src/application/tools/skills.ts)。验证：[skills.test](../tests/skills.test.ts)、[run-resources.test](../tests/run-resources.test.ts)、[Skills E2E](../tests/e2e/skills.spec.ts)、[故障脚本](../scripts/android-skills-fault.mjs)。
