# Android 测试前权限检查

- 更新时间：2026-10-21T19:45:57+08:00。
- 已提交代码基线：`9a6b3c38be2c3f7cc35e064b684038040b9f63e8`；以下修复尚未提交。
- 范围：工具派发、项目/快照/提案授权、MCP/Skills、Git 与原生文件接口、文档 WebView，以及 Android 合并清单。

## 已核对的权限边界

| 入口            | 实际边界                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主 Agent        | 工具闭包绑定启动项目，模型不能用额外 projectId 或绝对路径切换项目；角色 effect 在构建和调用前校验。当前主角色默认允许项目读写、受限暂存/提交、已授权 MCP 与一层委派。     |
| reader/reviewer | 只能读指定版本中显式授权的路径，列表和搜索也基于同一范围；无写入、Git 提交、MCP 或再次委派工具。                                                                          |
| writer          | 只改授权路径的私有候选树；合入由根任务核对权限、基线及整批冲突，不直接写实际项目或公开提交。                                                                              |
| Git 工具        | 暂存、取消暂存、提交必须属于根任务已触及且启动时干净的路径；检查 HEAD/index/文件修订，保留其他用户暂存内容。没有面向模型的 clone/fetch/push、分支切换或任意原生方法派发。 |
| MCP/Skills      | 按项目和工具描述指纹/技能版本授权；远程描述、技能 allowed-tools 和返回文字不能增加宿主权限。MCP 一律按远程副作用处理，不因服务端标注只读而降级授权。                      |
| 文件/凭证       | 正文工具不暴露 .git、SQLite 或 SecureStore；相对路径校验与原生父目录链接检查共同约束访问。仓库内普通文件属于项目授权范围，没有按文件名自动排除 .env 等内容的策略。        |
| 文档编辑器      | Markdown 原始 HTML 禁用；离线 WebView 禁止文件 URL 访问与外部导航，消息绑定当前文档 channel；图片走受控项目读取，外部链接经宿主检查。                                     |
| Android         | 导入使用系统文档选择器的选中文件 URI，导出分享受控 cache 副本；无需广泛存储、相机、录音或悬浮窗权限。                                                                     |

## 复现与修复

新增原生 `GitPermissionTest`，在隔离测试 APK 自己的私有目录创建仓库和外部哨兵。修复前五项均意外成功，证据为 work/native-git/permissions-baseline.log，不涉及真实项目或设备私有资料。

| 问题                                               | 修复                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| 底层 commit 经工作树链接目录读取外部文件           | 直接提交复用 filePath 的父目录检查，在暂存写入前拒绝。                  |
| .git 被改为指向另一个项目的链接，配置写入落到别处  | 每次派发前要求 .git 是当前项目内的真实目录，不接受 gitfile 重定向。     |
| core.worktree 改写实际工作树，底层暂存读取另一目录 | 打开仓库后核对 libgit2 的 workdir/gitdir/commondir 与固定项目目录一致。 |
| Git 对象根目录被链接到另一项目                     | 检查固定存储目录类型，拒绝链接和特殊文件；不接受对象库 alternates。     |
| 应用私有临时目录被链接到外部                       | 派发前检查 agent-mobile、tmp、plans 等固定目录，异常时在写文件前拒绝。  |

以上 Git 元数据重定向场景需要仓库私有元数据已经处于异常状态，普通 Agent 工具不能直接写 .git。它们是底层应独立拒绝的边界缺口，不等于已经证实远程模型可以任意调用原生接口。

Android 配置另外显式阻止 READ_EXTERNAL_STORAGE、WRITE_EXTERNAL_STORAGE、CAMERA、RECORD_AUDIO、SYSTEM_ALERT_WINDOW，并设置 allowBackup=false。修改位于 app.json，经 prebuild 生成；不将手改生成 Manifest 当作交付。实际保留 INTERNET、ACCESS_NETWORK_STATE、VIBRATE、SecureStore 依赖的 USE_BIOMETRIC/USE_FINGERPRINT 及应用自身的 signature 接收器权限；Debug 另有开发服务发现的 CHANGE_WIFI_MULTICAST_STATE。这些清单权限不授予模型额外工具或原生调用能力。

实际合并检查发现 Expo 的 Debug 清单优先级高于主清单，仍会加入 SYSTEM_ALERT_WINDOW。新增 plugins/with-android-permissions.js，将同一 blockedPermissions 同步至 debug/debugOptimized 清单，随后重新构建并检查实际合并结果。

## 当前授权语义

- “仅在用户要求时提交”目前是系统提示规则；宿主强制的是角色、项目、任务路径归属和版本，没有逐次人工确认 Git 提交的机制。不能将提示语描述为技术上证明用户意图。
- MCP/Skills 授权与凭证在运行接纳时冻结。设置里的撤权影响后续运行，不立即撤销已经接纳的运行；立即停止需取消当前运行。
- 主 Agent 获得的是整个选中项目的文件权限；应用的凭证库与业务库在项目外。把秘密主动放进项目正文，会进入当前项目授权范围。
- 原生模块属于可信宿主，未向模型或动态网页开放。当前检查不证明能抵御 root、任意同 UID 恶意原生代码或开发调试权限；iOS 和厂商设备迁移行为仍需相应平台验证。

## 本次验证

仅列本轮实际结果，不套用 10 月 19 日的验收数量。

| 检查                                | 结果                                                                                                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 授权专项 Vitest                     | 4 项通过，含新增跨项目参数伪造和快照越权/搜索拒绝。                                                                                                                                      |
| 原生缺口修复前复现                  | 5 项均复现意外成功，见 permissions-baseline.log。                                                                                                                                        |
| Android 应用/原生测试编译与原生回归 | x86_64 应用与测试 APK 编译通过；正式原生接口 22 项通过，含新增 5 项权限回归；隔离探针、HTTPS、取消与证书拒绝通过。见 permissions-android-final-build.log、permissions-native-tests.log。 |
| Debug/Release 合并清单              | 两种清单均不含 5 项阻止权限，allowBackup=false，见 permissions-manifests.json。Release 仅验证清单，未编译/运行 Release APK。                                                             |
| npm run check、格式与 diff 检查     | 最终源码的 TypeScript、ESLint、40 文件/305 测试通过；涉及文件的 Prettier、git diff --check 通过，见 permissions-final-check.log。                                                        |
| Expo Doctor                         | 21/21 通过，见 permissions-expo-doctor.log。                                                                                                                                             |

安装并启动新版应用做启动冒烟的组合命令被自动审批拒绝（工具仅返回 blocked by policy，未提供具体原因），命令未执行；不将已编译 APK 或已通过的测试 APK 当作新版产品应用启动成功的证据。

详细稳定契约已同步 docs/native-git.md、docs/development.md 与 docs/design.md。日志、APK 和测试仓库保存在忽略目录 work/native-git；本轮不自动提交修改。
