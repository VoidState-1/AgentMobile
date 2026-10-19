# 合并与冲突处理实施记录

本文件保留当时的实施与验证过程；后续已完成变基，并按用户要求移除高级扩展计划。当前范围与本次验收以 [Git 接入验收](git-integration-2026-10-19.md) 为准。

## 当前实施状态（2026-10-19T14:43:24+08:00）

下方保留最初准备时的设计与事实；当前源码已经实现原生 merge、三方冲突预览/编辑/解决、继续/中止及统一日志与会话恢复。native capability.merge=true，Web=false，rebase 仍为 false。源码尚未提交，代码基线仍是 `262940983352666ec86b8389fc656ed368f5680d`。

- `mergePlan` 使用内存索引与隔离 checkout；实际文件/index/HEAD 不先变化。空 baseline 修正目录/文件冲突的检出，raw 结果再按冻结合并属性过滤；冲突 `.gitattributes` 使用当前侧。
- 统一日志增加 conflictsChange、gitStateChange、completionReceipt、commitDependencies，保护真实三方 stages 和依赖对象。虚拟基础产生的 stage blob 另外固定私有树引用。文件/index/状态/HEAD/完成引用/SQLite 依次推进；完成引用或已更新 HEAD 使回执恢复保留后续用户编辑。
- `git-merges` 保存原始 HEAD/分支/raw 快照、来源/基础、触及路径、冲突临时项和 pending 操作。建立/继续/中止在意图前拒绝时撤回 pending；意图确认丢失阻断并启动恢复。
- 冲突选择当前/传入/基础/删除/已保存工作结果；目录相关路径成组处理，删除子文件并清理 checkout 临时项。继续使用双父提交，不能由普通 commit 代替。Agent 和普通暂存/取消暂存受状态保护。
- GitTree 改用无原型映射，合法文件名 `constructor`/`toString`/`__proto__` 不再误判；新增写入/暂存中断恢复/提交/切换的回归。

当前验证：`merge-final-check.log` 的 npm run check 通过，39 文件、292 项测试，其中合并恢复 11 项，包括标准 Git GC 后继续读取虚拟基础对象。`merge-edge-device.log` 7 项 Android 真原生测试通过，包括三方文本/二进制/链接、目录/文件、重命名/删除修改、unborn/快进/无共同祖先、执行位/特殊文件名、合并属性和双父历史。`merge-retention-application.log` 和 `application-summary.json` 的 f7 真实 AppServices/SQLite/Hermes 两进程测试通过，包含目录冲突多种选择、对象引用保护和无关内容保留。`merge-final-ui.log` 完整手机界面链路通过：三方预览、采用传入、继续、双父历史和确认中止；截图为 work/native-git-three-way-conflict.png、native-git-merge-history.png。`merge-arm64-build.log` 交叉编译通过，不是真机运行证据。文档格式和 git diff --check 通过。

当前稳定契约见 docs/native-git.md、application-api.md、storage-and-recovery.md、workspace-and-git.md、design.md。rebase、stash/cherry-pick/revert/reset/reflog、SSH 与 iOS 编译/设备验收仍未完成，完整 Git 目标仍进行中。

## 最初实施准备（以下保留历史）

- 时间：2026-10-19T12:54:00+08:00。
- 代码基线：262940983352666ec86b8389fc656ed368f5680d；当前原生接入源码尚未提交。
- 本节记录最初的设计准备，当时 native capabilities.merge/rebase 仍为 false；当前状态以顶部实施记录和源码为准。

## 已有基础与主要缺口

对象/模式模型、统一 SQLite 操作日志、HEAD 引用切换、私有 checkpoint、每仓库原生租约与中断旧锁清理已存在。分支切换支持部分效果恢复，文件/目录互换以及 ignored 内容保护。HTTPS 协作已有 clone/fetch/push、上游、认证、取消与未知结果核对。

普通 GitTree 只表示 stage 0，GitPort.index 在存在冲突时拒绝读取。MutationCoordinator.apply 目前无条件读取普通 index；文件编辑在冲突中也会因此失败。不能直接调用会修改工作树的 git_merge，然后再补 SQLite 意图；也不能把冲突索引摊平成普通树或遗失三方 stage。

## 实施方向

1. 新增真实的索引状态接口：stage 0 entries 与完整 base/ours/theirs 冲突条目。保留各侧 path/OID/mode。原生以一次 git_index_write 原子写入普通条目及冲突 stages；普通 index 接口继续拒绝冲突。
2. 用 git_merge_commits 或 git_cherrypick_commit 准备内存索引和目标文件，不先修改实际工作树。快进使用已有切换计划；干净三方合并先生成无公开 ref 的双父 commit object；冲突则保留真实 index stages 并准备有界标记内容。二进制、链接和重命名冲突必须保留类型，不强行当文本处理。
3. 继续复用统一 OperationJournal。增加所需的 conflictsChange 和受限 Git 状态文件 before/after；不要另建一套 C++ checkout/merge 日志。多文件 Git 状态可逐字段验证属于 before/after，再补齐部分效果。所有允许的状态文件名必须在原生固定枚举中，不能接受任意 .git 路径。
4. 对没有 HEAD 变化的冲突建立/解决操作，需要原生私有 applied ref 作为效果完成证据，最后写入；回执缺失时据此只补业务记录，保留后续用户内容。文件、index、Git 状态先完成，再更新 HEAD/完成标记，最后写 SQLite 回执。
5. 意图前固定所有恢复需要的对象与提交。尤其新生成的 merge commit 和传入提交不能只被 SQLite OID 引用；用私有 checkpoint 保护。恢复仍整批拒绝第三种内容。
6. clean/smudge 需要使用冻结属性来源。可增加按属性快照过滤指定 GitEntry 的接口，用于冲突侧选择及结果暂存；避免先写工作树再计算要记录的索引目标，也不把 raw 工作 OID 当作 clean index OID。

## 应用用例

业务合并 session 记录原始分支/OID、来源、开始操作 ID、原始 raw 快照和触及路径。session 元数据先于文件意图保存；恢复通过实际 journal 区分“尚无效果”和“已应用”。文件意图成功后，session 回执失败也要阻断并在启动补齐。

- 开始：检查完整 GitStatus、项目占用、全部持久草稿和无未提交更改；不自动合并无共同祖先的两个仓库。
- 解决：校验三方阶段与工作修订，选择 ours/theirs/base/删除/当前已保存结果；冻结工作属性后准备 clean index 目标并日志化。结果编辑可复用现有文件编辑器和持久草稿，避免另造不可恢复的临时文本编辑状态。
- 继续：冲突清零后，以当前 index 生成双父提交，日志化状态清理与 HEAD 更新。不能沿用只产生单父提交的普通 commit 路径。
- 中止：恢复 session 触及的文件与索引，并清理合并状态；保留不相关用户文件。目录中的第三种/ignored 内容仍阻止覆盖。HEAD 或分支已脱离原合并基线时拒绝。
- Agent：在合并/rebase 未完成时应拒绝新根任务；受控 Git 工具也继续拒绝处理这些状态。不要只靠 UI 禁用按钮。

## 界面与验证

手机采用冲突文件列表和基础/当前/传入/结果页签；显示删除、链接、二进制等类型。编辑结果进入现有文档编辑器，保存后明确“标记为已解决”。继续与中止使用受控用例，中止需要具体确认。

优先 Android 原生实现和标准 Git 互操作，Web 未实现时保持 capability=false。验证覆盖双父历史、真正的三方 stage、文本/二进制/执行位/链接/重命名与目录冲突、CRLF/属性，以及文件/index/状态/HEAD 各中断点和回执缺失。通过后再开放 capability 并更新稳定文档。

rebase、cherry-pick/revert、stash/reset/reflog 与 SSH 仍是后续实际工作，不能因这里出现设计说明而记为完成。iOS 仍需 macOS/Xcode 编译与设备证据。
