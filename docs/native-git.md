# 原生 Git 引擎与工作区

## 文档更新历史

| 文档版本 | 更新时间                  | 最新 Git 提交 ID（代码基线）             | 内容变化                                                                                   |
| -------- | ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| 2.3.0    | 2026-10-19T17:56:09+08:00 | 414863fdcd788534b2232fea740024864a8726a4 | 对应已提交源码：收敛为本地 Git、HTTPS、合并/变基与恢复，移除超出范围的扩展。               |
| 2.2.0    | 2026-10-19T16:39:00+08:00 | 262940983352666ec86b8389fc656ed368f5680d | 同步尚未提交源码：变基重放、分支 CAS、状态恢复、共用冲突服务及开发专用 UI fixture 入口。   |
| 2.1.0    | 2026-10-19T14:43:24+08:00 | 262940983352666ec86b8389fc656ed368f5680d | 同步尚未提交源码：三方合并、冲突编辑、完成标记、冻结属性与合并会话恢复。                   |
| 2.0.0    | 2026-10-19T12:13:46+08:00 | 262940983352666ec86b8389fc656ed368f5680d | 同步尚未提交源码：正式 GitPort、对象日志、分支恢复、HTTPS 克隆/获取/推送、认证和结果核对。 |
| 1.0.0    | 2026-10-18T20:30:20+08:00 | 262940983352666ec86b8389fc656ed368f5680d | 记录尚未提交的 libgit2 验证模块、构建、隔离与能力边界。                                    |

## 1. 当前接入

[本地 Expo Module](../modules/agent-mobile-git/) 提供移动端实际 Git 和正文存储。UI 经 AppServices、WorkspaceApplication 和 GitPort 调用；[平台选择](../src/adapters/git/platform.native.ts) 由 Metro 解析，Web/Node 使用浏览器适配，不在移动端构造 isomorphic-git 文件系统。

当前已接本地暂存、提交、差异、恢复、分支、标签、提交身份、远程地址、HTTPS clone/fetch/push、上游、认证、传输进度与取消，以及 merge/rebase 和三方冲突处理。SSH、stash、cherry-pick/revert、reset/reflog 不在本次实现范围；按 repository.capabilities 控制界面，不能把底层库拥有 API 当作软件已支持。

引擎固定 libgit2 1.9.7，JSON 使用 nlohmann/json 3.12.0。[依赖清单](../modules/agent-mobile-git/native-dependencies.json) 与[准备脚本](../scripts/prepare-native-git.mjs) 校验源码和补丁，生成[许可清单](../licenses/native-git.txt)。下载源码、原生构建产物和 XCFramework 不提交。

Android 使用[最小 chmod 补丁](../modules/agent-mobile-git/patches/android-posix-permissions.patch)，只对应用私有 POSIX 目录启用真实权限操作，不推广至 SAF/FAT 外部目录。

## 2. 目录、线程与授权

正式 execute 接收 projectId、operationId 和受控请求；仓库路径由原生层在应用私有 workspaces 目录定位，拒绝根路径 symlink 越界。调用方不能指定 gitdir、任意原生根目录或 shell。Agent/界面不直接取得 Native Module；Agent 只持有原有受控工具。

Android 使用工作线程池；共享 C++ 核心以每仓库 timed_mutex 和私有父目录的 flock 串行化单次 RPC，覆盖 React Context 重载后的旧工作线程及其他应用进程。等待租约的任务可取消，已关闭桥实例不能再启动工作。JNI 保存 JavaVM/全局引用，在 libgit2 内部 pack 线程回调时 Attach/Detach，禁止复用另一线程的 JNIEnv 或局部引用。iOS 使用 Swift/Objective-C++ 入口和同一 C++ 核心。

原生正文接口使用 lstat，不遍历 symlink 目录；链接读取返回链接本身的目标文本，正文写入拒绝 symlink。普通文件使用 O_NOFOLLOW、私有临时文件、fsync 和 rename；移动使用不覆盖目标的原子 rename。Git 版本恢复可显式重建链接或文件模式，同时保持正文工具不能修改链接的约束。大文件导出先在受控 cache 中原生复制，再交系统分享，不把正文传到 JS。

Android HTTPS 为系统 SSLSocket，保留证书链和主机名验证；取消可关闭活动连接。iOS 配置为系统 SecureTransport，尚未完成 Xcode/设备验证。当前 SSH、HTTP CONNECT 代理、SHA256 仓库和外部过滤器不作为已支持能力。

传输只接受无内嵌凭证的 HTTPS 地址，当前不跟随重定向。远程认证绑定具体 URL；原生 credential 回调校验来源，仅允许一次用户名/令牌挑战。令牌只保存在 SecureStore 和调用期间内存，不写入 Git config、SQLite 意图、进度或错误。获取与推送当前使用同一远程 URL。

推送固定源 HEAD OID，先读取远程目标，再在 negotiation 回调核对远程旧 OID；只允许标准非强制推送。服务器拒绝或非快进有明确失败；发送后失去确认时返回 uncertain，并保留 pendingPushes。verifyPush 显式读取同一远程地址的当前分支，返回实际 OID 与是否匹配；当前不匹配不等于历史推送一定没发生。界面可在项目写队列占用期间取消传输。

## 3. 对象、索引与恢复

GitEntry 记录 blob/commit revision 和 mode，GitTree 是路径到 Entry 的映射。树、索引和 checkpoint 不传整仓正文。index 的冲突 stage 保留在原生 Git 事实中；普通索引接口在冲突未解决时拒绝把它降格成 stage 0。

`indexState` 读取 stage 0 与完整 base/ours/theirs 条目，各侧保留 path/OID/mode。`setIndexState` 整批验证原有冲突属于 before/after，在内存索引中更新条目与冲突 stages，最后只调用一次 `git_index_write`。GitTree 使用无原型路径映射；`constructor`、`toString`、`__proto__` 是合法文件名，不作为对象内置属性处理。

文件日志 before/after 引用 Git 对象，SQLite 不再保存 Base64 文件前后像。准备意图前建立私有 before/target 快照，保护所需对象；实际应用先整批比较当前版本属于 before/after，第三种内容阻断。发生中断后，已经等于 after 的路径跳过，剩余路径继续。Git 与 SQLite 仍没有跨存储事务。

工作快照按原始字节建立，保留 CRLF/BOM；暂存通过 Git clean 过滤产生标准索引内容。任务的未提交状态从冻结工作快照的属性计算，不读取后续被修改的工作目录属性。对象读取启用严格哈希校验，同时开启 Git 目录 fsync；这些措施与进程中断测试不构成硬件断电原子性的证明。

HEAD 可为 null；Git 初始化不制造提交。应用的笔记模板创建和远程空仓库是不同用例，clone 不应向外部仓库插入项目配置或示例。project.json 是普通仓库文件。

分支切换检查 GitStatus、项目占用、未提交文件及所有持久草稿。switchPlan 准备 raw 文件目标和 index；统一应用日志保存 indexChanges 与 headChange，按文件 → index → HEAD 顺序应用。expectedHead 和 expectedBranch 同时校验。部分文件已经完成时只继续剩余效果；发现第三种内容则保留现场并阻断。HEAD 已切换但回执中断时只补齐记录，不重放覆盖后续用户文件。文件/目录互换先删后建，只移除已经清空的目录；未跟踪或 ignored 内容阻止覆盖。

启动恢复先持有独占原生租约，校验并清理已知 index/HEAD/config/packed-refs/shallow/ref/reflog 锁；不扫描删除任意 .lock，不触及对象或用户文件。遇到符号链接或特殊锁拒绝整批清理，再由业务层阻断该项目写入。

clone 使用新项目 ID 的独立 clone-staging；成功下载、检出及路径验证后保存私有 clone-ready.json，记录 URL、操作 ID 和 HEAD，再原子 rename 为 repository。业务库以同一事务登记 Project 和完成回执。重启可发布完整暂存仓库或补齐已发布仓库的业务记录；未完成下载只清理该导入暂存。下载不能断点续传；网络失败后需要重新发起克隆。已发布仓库不能作为暂存目录清理。

### 合并与冲突

`mergePlan` 先检查工作区干净，再用 libgit2 查询祖先、快进或通过 `git_merge_commits` 准备内存三方索引。不会先修改公开 HEAD、实际 index 或工作树。冲突 checkout 位于私有 plans 目录，以空 baseline 处理目录/文件冲突；先禁止过滤取得 raw 结果，再根据合并结果的冻结属性 smudge。冲突的 `.gitattributes` 暂用当前侧，避免将冲突标记解析为属性。计划临时目录在成功或失败时清理。

干净合并先生成无公开引用的双父 commit；快进直接准备已有目标。冲突保留三方 stages 和 `MERGE_HEAD/MERGE_MSG/MERGE_MODE`，`ORIG_HEAD` 记录开始位置。没有共同祖先时明确拒绝；涉及子模块变化时拒绝，不自动初始化子模块。

[MergeService](../src/application/workspace/merges.ts) 使用同一项目队列、GitStatus、持久草稿保护及统一 OperationJournal。`git-merges` 保存开始 HEAD/分支、来源/基础提交、原始 raw 快照、触及路径、checkout 临时项和待完成操作 ID。意图前固定需要的提交依赖和所有冲突 stage 对象；递归合并产生的虚拟基础 blob 也通过私有树引用保护，不能假定它已被来源提交引用。应用顺序是工作树 → 索引/stages → 受限 Git 状态文件 → HEAD → 私有完成引用 → SQLite 回执。状态接口只接受 core/git/merge.ts 与原生层一致列举的合并/变基文件，不能操作任意 `.git` 路径。

无 HEAD 变化的操作通过 `refs/agent-mobile/applied/<operationId 的 blob 哈希>` 记录完成，值为日志 checkpoint。存在且匹配时只补业务回执，保留后续用户编辑；不匹配则阻断。Git 状态多文件部分完成时逐字段比较 before/after 并继续，发现第三种值则保留现场。

用户可预览基础/当前/传入/结果，选择一侧、删除或将已经保存的工作结果标记为已解决。文本结果复用现有编辑器及持久草稿；模式、二进制与链接保留类型。目录/文件相关路径成组处理，删除会移除该组子文件，选择目录一侧会保留其子文件并清理本次 checkout 生成的冲突临时项。继续合并要求无剩余冲突，并生成双父提交；中止恢复本次触及路径和索引，保留无关用户更改，遇到未跟踪/ignored 结构阻挡时拒绝覆盖。

启动先恢复统一操作日志，再收束合并会话：尚无已登记文件意图的 pending 会话撤回到原状态，recorded 意图补齐 active/completed，基线异常阻断。意图登记确认丢失时立即暂停该项目写入；预检拒绝且没有意图时允许直接重试。合并期间 Agent 根任务、普通暂存/提交和仓库配置命令受用例层保护。

### 变基与原分支保护

[RebaseService](../src/application/workspace/rebases.ts) 用 libgit2 `git_rebase_init(inmemory=1)` 取得默认 pick 列表，`git_cherrypick_commit` 在内存准备每步索引，再复用隔离 checkout、冻结属性和同一文件日志。开始前要求干净工作区及无持久草稿，支持无变化、快进及逐步重放；默认按 libgit2 的线性重放列表处理，不保留 merge 拓扑。单次最多 1,000 个提交，状态单字段最多 65,536 UTF-8 字节，超预算在登记文件意图前拒绝。

`git-rebases` 保存原始 HEAD/分支/raw 快照、目标、原提交及其作者/说明、position/currentOid、ready/conflicts、触及范围、当前步路径、临时项、重写/跳过映射和 pending 操作的目标进度。开始后 HEAD 分离到目标提交，原分支保持起始 OID，提交逐个重写。`rebaseCommit` 保留原作者、作者时间、编码及说明，使用当前提交者；原本的空提交保留，重放后变空的非空提交省略。每步的新 commit object 在意图前固定，HEAD 只在文件/index/状态成功后移动。

状态使用 `REBASE_HEAD` 与固定的 `rebase-merge` 文件：head-name/orig-head/onto、git-rebase-todo/done、msgnum/end、stopped-sha/message/author-script、rewritten-list、interactive/quiet。目录与文件拒绝 symlink，未知文件拒绝覆盖。根目录和变基目录内的私有 `.agent-mobile-state-<固定字段>-<随机后缀>` 中断临时文件经类型校验后收束；仅删除空的状态目录。作者脚本内容使用完整 shell 单引号转义，产品不执行该脚本或任意 todo 命令；这是供标准 Git 读取的状态数据。

完成时 `headChange.branchGuard` 携带原分支名/OID：先以 CAS 更新原分支，再挂接 HEAD。原分支已更新但 HEAD 仍分离时可幂等补齐挂接，第三种原分支 OID 拒绝覆盖。中止恢复原 HEAD 与本次触及路径，保留无关用户改动；跳过仅恢复当前步并继续后续提交。新步骤准备保护被触及的未提交/未跟踪内容，不用整个目标树覆盖无关用户编辑。

merge/rebase 共用 [ConflictService](../src/application/workspace/conflicts.ts)。变基的当前侧是目标分支及已重放结果，传入侧是正在重放的原提交；继续要求冲突清零。启动先恢复统一 journal，再对账 pending 进度；中断后的 ready 状态等待用户继续，不自动开始新步骤。外部修改原分支、待重放列表或步骤状态会阻断。当前不支持交互式重排/squash/reword、`--rebase-merges`、外部已有变基的接管或 notes 重写。

## 4. 构建与验证入口

```sh
npx expo prebuild --platform android --no-install
npm run prepare:git
npm run android
npm run test:git:android -- <device-serial>
```

原生改动必须重新构建 Development Build，不能只依赖 Metro。GitRepositoryTest 为正式接口测试；GitProbeTest 为早期隔离探针，二者不能互相替代。探针的 probe 仅 Debug 注册，正式 execute/cancel 在 Release 也存在。

`GitMergeTest` 验证真实三方 stages、目录/文件和重命名冲突、换行/合并属性、快进/unborn、执行位、特殊文件名和双父提交。`tests/git-merge.test.ts` 用标准 Git CLI 构造计划，验证应用日志/会话恢复；它不替代原生序列化验收。`scripts/android-native-git-merge-ui.mjs` 驱动手机三方预览、解决、继续与确认中止。

`GitRebaseTest` 验证内存计划、作者/说明、原有空提交、变空省略、分支 CAS 部分效果、冲突/属性及状态重启；`tests/git-rebase.test.ts` 验证会话和统一日志中断。默认 Android 验证脚本会先运行正式 Repository/Merge/Rebase 类，再运行隔离 probe。`scripts/android-native-git-rebase-ui.mjs` 驱动原生变基入口、冲突侧、继续/跳过/中止。应用两进程验证完成后、UI 消耗活动 fixture 前，可运行 `node scripts/android-native-git-rebase-interop.mjs <serial>`：仅复制自己的活动测试项目，用标准 Git 检查 stages、当前 patch、继续和 fsck，并校验含引号和 `$()` 的作者名按原文保留。

独立测试 APK 为 com.agentmobile.git.validation，仅写自己的 fixture。测试结果保存在忽略的 work/native-git 中；宿主 Git CLI 可核对导出的标准仓库。软件集成入口 scripts/native-git-application-entry.tsx 使用真实 AppServices/SQLite；运行前启动 Metro 4182，并按提示重建测试用开发实例（设备凭证保留）。然后执行：

```sh
npm run test:git:bridge -- <device-serial> --application
```

脚本从零创建自己的 fixture，force-stop 后第二次核对 SQLite 与 Git；普通 probe 桥接模式不经过产品服务。验收步骤和实际结果记录在 Design，不能把旧格式或旧原型结果当作当前证据。

应用两进程验证成功后，可依次运行 `node scripts/android-native-git-merge-ui.mjs <serial>` 和 `node scripts/android-native-git-rebase-ui.mjs <serial>`。UI 脚本通过 `AGENT_MOBILE_METRO_PORT` 选择 Metro 端口（这里需设为 4182），桥接脚本则使用 `AGENT_MOBILE_GIT_METRO_PORT`，默认 4182。UI 入口仅在开发环境注册，使用静态路由上下文加载真实应用，经 AppServices 选择本次报告中的自有 fixture；校验固定字段、项目 UUID 与名称，不向产品增加测试路由。测试会完成或中止这些会话，重跑前需重新生成应用 fixture，不能把已消费的会话当作初始冲突。

`node scripts/android-native-git-remote.mjs <serial>` 在宿主创建标准 Git HTTP 后端、临时证书及独立 bare 仓库，用测试 APK 校验认证推送/获取/克隆、上游、过期版本、非快进、取消和响应丢失。生成证书只注入测试进程的受控信任库，产品 TLS 策略不变；测试证书、私钥与仓库在本次 work fixture 内生成并清理。该测试不等价于真实托管服务的分支保护、SSO 或权限策略验收。

macOS 上执行 npm run build:git:ios 后构建 iOS。脚本生成真机 arm64、模拟器 arm64/x86_64 XCFramework；Windows 上的自动链接解析、bundle 导出和源文件存在不证明原生编译通过。

## 5. 当前限制

iOS 原生编译、arm64 真机、大仓库资源测量和完整界面仍需后续验收。SSH、stash、cherry-pick/revert、reset/reflog 不在本次范围，未提供接口、占位能力或界面入口。Web 暂不提供网络 Git、merge/rebase 与冲突处理；iOS 源码存在不表示已通过编译。当前不运行 hooks/任意脚本，不自动初始化 submodule，不宣称 LFS 或签名可用。私有 refs 和导出 cache 的保留/清理需要单独维护，不推送内部 checkpoint。文件路径仍使用应用的 UTF-8/相对路径规则，并非支持 Git 能表示的所有异常文件名。重命名冲突按真实索引中的路径逐项解决，尚无重命名关系图或交互式合并策略选择。
