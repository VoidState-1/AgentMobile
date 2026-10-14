# Git 工作流升级

日期：2026-10-14。状态：已实现，验证证据见 [validation.md](validation.md)。

## 交互

“版本”面板默认展示 Git 更改：未暂存、已暂存、提交说明及“提交已暂存”。支持单文件/全部暂存、取消暂存、两类差异、确认后丢弃未暂存内容，以及独立提交历史。手机与桌面共用界面，适配深浅主题。

保存、导入、移动、删除只修改工作区；初始化仍有一个基础提交。暂存冻结当前字节，后续编辑不改变暂存内容。取消暂存用 HEAD 替换选定 index 项，不改工作文件。丢弃恢复为 index 内容，未跟踪文件移除。提交必须有 1–4,000 字符说明，不能创建空提交。界面提交所有已暂存文件，Agent 可提交子集。

历史预览为父提交与该提交的差异；历史恢复要求工作区和暂存区干净，恢复后是待提交改动。旧版自动提交历史保持原样。

## Git 与恢复日志

使用 isomorphic-git 1.44.2 的真实对象、HEAD 和 `.git/index`，可由标准 Git CLI 读取。stage 使用 blob OID 更新 index；commit 从 HEAD 加选定 index 项构建树，提交已暂存版本，不从工作文件重新 add。

内部检查点是带独立引用的 Git commit，位于 `refs/agent-mobile/checkpoints/`；不移动 HEAD，不改变 index，不出现在普通 `git log` 中。操作、index 前后树、提交意图、任务前后工作区/index 分别有引用。它们是恢复数据，不是用户提交，未来需要容量/保留期管理。

SQLite Operation 新增可选 kind：files/index/commit 与项目单调 sequence，不依赖查询返回顺序。缺失 kind 表示旧版日志，继续旧自动提交恢复。files：prepared → applied → checkpointed → recorded；commit：prepared → committed → recorded。恢复先校验 HEAD、文件和 index 的 before/after，未知状态冻结项目。commit 使用不可变树与操作标记，Git 成功但数据库未补记时按标记查找，避免重复提交。文件内容、暂存和提交跨存储仍不具有共同事务；掉电/fsync 与底层原子替换保证尚未完成。

宿主项目队列串行读写，任务持有项目写锁。stage 检查 HEAD、index 指纹及选定文件修订号；unstage/commit 检查 HEAD 和 index 指纹；discard 额外检查完整工作区指纹。更新通知在 recorded 后立即发布，传递的 commit 始终是实际 HEAD。

技能库保持独立命名空间；安装、整体编辑、删除技能仍是一个明确包版本操作，使用旧版提交管线。不会把技能库版本混入项目历史。

## Agent 与任务

提供 git_status/git_diff/git_stage/git_unstage/git_commit。受控相对路径、不提供 shell，不暴露 .git 或原生调用。文件工具返回 saved/revision，不将内部检查点称为 commit。宿主系统规则要求只在用户要求提交时使用 git_commit。

任务开始捕获 HEAD、完整工作区和 index。Agent Git 写工具仅处理本任务成功文件操作涉及的路径，并要求这些路径在任务开始时的工作区和 index 均与 HEAD 相同。Agent 可修改已有脏文件，但由用户通过 Git 面板处理暂存/提交；不能夹带任务前已有改动。选择性提交保留其他用户暂存内容。

任务差异比较 baseSnapshot/finalSnapshot，按任务实际涉及的净变化路径过滤；finalCommit 可以等于 baseCommit。任务卡显示结束时待提交文件数。中断恢复从自身最后 recorded 文件/index 检查点补全，不把后续用户编辑归到旧任务。

撤销检查受影响路径的当前工作区/index 与任务结束版本相同，然后恢复任务前字节与暂存状态；无关路径保留，冲突拒绝。即使任务已提交也不改写历史，撤销成为新的待提交更改。旧任务保留提交基线回退。

## 尚未实现

分支/合并/rebase/远程同步、逐块暂存、Git LFS、仓库导入导出、检查点清理与 GC、跨进程/浏览器多页面锁、大仓库增量状态缓存、原生 libgit2 与后台线程。当前只展示 main；本地单仓库操作不需要手机安装 Git 命令行。
