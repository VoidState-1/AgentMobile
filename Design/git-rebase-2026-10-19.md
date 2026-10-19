# 原生变基接入记录

- 时间：2026-10-19T16:42:00+08:00。
- 代码基线：`262940983352666ec86b8389fc656ed368f5680d`；源码尚未提交。
- 范围说明：本轮保留已完成的合并/变基。SSH、stash、cherry-pick/revert、reset/reflog 已由用户明确移出本次范围；以下保留变基阶段的历史验证，最终验收见 git-integration-2026-10-19.md。

## 已实现

原生 `rebasePlan` 通过 libgit2 的 in-memory rebase 获取默认 pick 列表；`rebaseStep` 用 cherrypick_commit 准备索引与隔离 checkout，保留冻结属性、模式和真实冲突 stages。纯计划不修改实际文件/index/HEAD。`rebaseCommit` 保留原作者、作者时间、编码和完整说明，使用当前提交者；原有空提交保留，非空提交重放变空时省略。

应用层 RebaseService 通过统一 MutationCoordinator/OperationJournal 记录步骤。git-rebases 保存原始/目标、原提交元数据、position/currentOid、ready/conflicts、触及范围、当前步路径、checkout 临时项、重写/跳过映射及 pending 操作的目标进度。原分支起始 OID 保持不变，HEAD 分离到目标；文件/index/状态先完成，再移动步骤 HEAD。

最终 headChange.branchGuard 校验原分支 OID，CAS 更新后挂接 HEAD。原分支 CAS 已完成、HEAD 尚分离的中断可补齐；第三种原分支值拒绝覆盖。会话 pending 早于文件意图；无意图的预检拒绝撤回 pending，意图/回执确认丢失阻断。启动先恢复已有 journal，再对账 Progress，ready 状态等待用户继续，不自动开始新 pick。

受限 Git 状态扩展为 REBASE_HEAD 和固定 rebase-merge 文件。原生先整批验证 before/after 与大小，拒绝 symlink/未知文件；私有随机临时文件经类型校验后收束，状态目录只在为空时删除。应用层也在登记意图前以 UTF-8 字节数校验 65,536 字节预算，避免写入后才发现永远无法完成的意图。作者脚本使用完整 shell 引号保护；产品不执行脚本或任意 todo 指令。

冲突预览与选择从 MergeService 提取为 ConflictService，由 merge/rebase 两个实际用例共用；旧的重复路径已删除。变基当前侧是基底及已重放结果，传入侧是当前原提交。继续提交冻结 index；跳过恢复当前步，中止恢复整个触及范围，两者保留无关用户编辑。普通 stage/commit、Agent 新任务继续受操作状态保护。

手机 Git 页增加本地/远程分支的变基入口、步骤摘要、继续/跳过/中止；重写与丢弃动作展示具体确认。分支操作改为可换行布局；冲突结果继续使用已有文件编辑器。native capability.rebase=true，Web=false。

当前默认线性重放，不保留 merge 拓扑，不提供交互式 squash/reword、外部变基接管和 notes 重写。一次最多 1,000 个提交，超出预算明确拒绝。未实现项在稳定文档中保留，不作为完整 Git 完成的依据。

## 当前证据

- rebase-final-check.log：40 文件/303 测试、类型检查与 ESLint 通过。其中 rebase 应用恢复覆盖连续重放、作者/说明、三方侧、跳过/中止、状态/SQLite/原分支 CAS 中断、第三方原分支变更、UTF-8 预算拒绝及技能库恢复与用户会话隔离。测试通过 Git CLI 提供计划，原生序列化证据另见设备结果。
- rebase-current-device.log：真实 Android GitRebaseTest 4 项及 GitMergeTest 7 项通过。
- rebase-final-application.log / application-summary.json：真实 f7 AppServices/SQLite/Hermes 两次进程运行，覆盖 rebase session/stages/detached HEAD 重启、编辑/继续/跳过/中止及元数据；旧 merge/HTTPS/SecureStore 链路仍通过。
- rebase-final-interop.log / rebase-cli-summary.json：复制自己活动的原生测试仓库，用标准 Git 检查三方索引、show-current-patch、continue、线性父链、原分支及 fsck；含 `O'Neil $(printf should-not-run)` 的作者名按原文保留。只在复制的测试仓库中运行 Git CLI，产品没有 shell 后门。
- rebase-current-build.log：x86_64 主 APK/测试 APK 编译、安装并运行。rebase-arm64-build.log：完整 ARM64 Debug APK/测试 APK 编译通过；后者覆盖默认输出路径，不能直接安装到 x86_64 模拟器。没有 ARM64 真机证据。
- rebase-native-gate.log：正式 Android Repository/Merge/Rebase 共 17 项通过，隔离 probe、HTTPS、取消与不受信任证书拒绝通过。
- rebase-native-ui.log：真实手机路由通过三方侧校验、采用传入版本、继续及线性历史、确认跳过/中止，以及从仓库分支入口发起变基再中止。截图为 work/native-git-rebase-conflict.png 和 work/native-git-rebase-history.png。
- rebase-shared-merge-ui.log：同一开发入口下的合并 UI 回归通过，包含三方预览、采用传入、双父历史与确认中止。
- rebase-web-build.log：重新导出 work/prototype-export，4180 预览继续提供当前软件。rebase-web-ui.log：Git 工作流及仓库管理 4 项通过；Web 仍不提供原生 merge/rebase 能力。
- rebase-final-format.log：全仓 Prettier 检查通过；git diff --check 通过。顺手规范了两个原有 JSON 配置/测试回执的文件末尾空行，没有内容变更。

第一次把 ARM64 首次全构建与全量测试并行，CPU 争用造成多项 15 秒超时及清理失败；等待构建完成后保持原超时门槛单独重跑，301 项通过。没有通过放宽测试时限掩盖失败。

UI 验证入口先因带类型断言的 require.context 调用不能被 Metro 正常识别而卡住；尝试默认 expo-router/_ctx 后，开发客户端的独立 bundle 请求又回落到不存在的 app 目录。最终使用字面量参数的直接静态 require.context，显式加载 src/app，并在 fixture 选择时检查 index 路由存在。入口仅限 **DEV**，只选择报告中 UUID/名称匹配的自有项目，经 AppServices 操作，不给产品添加测试路由或修改用户仓库。共享 UI helper 原先仅依赖项目列表定位，改为缓存文件加随机 token 回执，避免积累的测试项目影响定位。

稳定契约已经更新 docs/native-git.md、application-api.md、storage-and-recovery.md、workspace-and-git.md、design.md。历史合并结果仍在先前的独立实施记录中。
