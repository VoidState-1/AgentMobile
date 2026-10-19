# libgit2 原生引擎验证与模型决策

- 更新时间：2026-10-18T20:54:00+08:00
- 代码基线：`262940983352666ec86b8389fc656ed368f5680d`；本报告对应尚未提交的模块与脚本。
- 范围：验证原生引擎与 Expo/Hermes 桥接，确定后续仓库模型；尚未替换产品 GitPort。

## 1. 实现与结论

新增 [本地 Expo Module](../modules/agent-mobile-git/)、共享 C++ 验证核心、Android JNI/系统 TLS、iOS Swift/Objective-C++ 入口与 XCFramework 构建脚本。libgit2 固定 1.9.7、提交 `49e408b3208bc3093757a1c2db938d3590f3f412`，原始归档 SHA256 为 `173c45822177d73bb1a97555d864ad04a3e0486eb0bc3455443a4669a35d8aa2`。

Android 上本轮验证通过，可以进入产品仓库模型与适配层重构。iOS 已确认 Expo 能解析 Pod 路径与 Module 类，但仅完成构建配置与代码准备；当前 Windows 环境没有完成 Xcode 编译或设备验证，因此不能得出双端都已通过的结论。

模块只操作自己 cache 内的 fixture。应用和 Agent 仍使用原有 isomorphic-git，不读写真实项目的 Git 引用，不改变用户凭证，不进行外部 push。稳定构建说明和接口边界见 [原生 Git 文档](../docs/native-git.md)。

## 2. 本轮实际验证

设备为 `emulator-5554`、Android 16 / API 36.1、x86_64。下表只列本次真实执行结果。

| 检查                                               | 结果                                                    |
| -------------------------------------------------- | ------------------------------------------------------- |
| Expo 自动链接、新模块和主应用 Debug 编译           | 通过                                                    |
| Android arm64-v8a Release AAR 编译                 | 通过，未在 arm64 真机运行                               |
| 空仓库与初始提交                                   | 通过                                                    |
| HEAD/index/worktree 独立状态                       | 通过                                                    |
| gitignore、UTF-8/emoji 路径、100755 与 120000 模式 | 通过                                                    |
| 分支切换、模式恢复、拒绝覆盖冲突的未提交改动       | 通过                                                    |
| 冲突 index stage 1/2/3、解决后生成双父提交         | 通过                                                    |
| 操作前干净 fixture 的 merge 撤销                   | 通过，不代表通用产品 abort                              |
| 进程退出、force-stop、重启后继续处理冲突           | 通过，HEAD/冲突内容/合并父关系保留                      |
| 24 MiB 二进制暂存与提交                            | 通过，字节不经 JS                                       |
| 本地 bare remote 的 clone/fetch/push               | 通过                                                    |
| 公开 GitHub HTTPS clone/fetch                      | 通过，系统 TLS；无凭证                                  |
| 传输开始后取消、临时 clone 目录清理                | 通过                                                    |
| 路径穿越、凭证 URL、非 HTTPS、未知 phase 拒绝      | 通过                                                    |
| self-signed.badssl.com 不受信任证书拒绝            | 通过，实际 SSLHandshakeException                        |
| 标准 Git CLI `fsck --full`                         | 7 个导出仓库全部通过                                    |
| Hermes/Expo version、Promise、事件和 JS timer      | 通过，38 次本地进度事件，原生运行期间 JS timer 继续执行 |
| Hermes 调用原生 cancel                             | 通过，JS 收到阶段事件后取消，原生确认并清理临时 clone   |
| TypeScript、ESLint、Vitest                         | 本轮执行 npm run check；37 个文件、260 个测试通过       |
| Expo Doctor                                        | 本轮执行，21/21 通过                                    |

原始证据位于被忽略的 `work/native-git/probe-1792327305085/summary.json`、各阶段 instrumentation 日志、导出的 Git 对象数据库，以及 `work/native-git/bridge-summary.json`、原生构建日志。证据目录可通过验证脚本重新生成，不提交构建/测试数据。

首轮 instrumentation 测得：24 MiB 可压缩二进制创建/暂存/提交约 682 ms；公开仓库 HTTPS clone 约 2084 ms、fetch 约 1665 ms；本地阶段进程 VmHWM 为 169368 KiB。VmHWM 包含 Android/JUnit/运行时和所有本地步骤，不是 libgit2 单独占用，也没有旧引擎的同条件对照，不能用于宣称性能提升倍数。该 fixture 不是大型真实仓库性能验收。

arm64 Release 的 stripped `libagent_mobile_git.so` 为 1497864 字节，ELF LOAD 对齐为 `0x4000`（16 KiB）；AAR 为 1076881 字节。它们是验证模块构建产物的大小，不等于最终 APK 增量，也不替代 16 KiB 真机运行验证。

## 3. 验证中发现并修复的问题

### Android 权限位

libgit2 上游 `src/util/unix/posix.h` 将所有 Android 的 `p_chmod` 设成空操作，沿用了早期 FAT 存储假设。实测应用私有目录支持真实 chmod，而上游的初始化探测因此错误生成 `core.filemode=false`。

增加了可复现的 [最小补丁](../modules/agent-mobile-git/patches/android-posix-permissions.patch)：仅在本构建定义 `AGENT_MOBILE_POSIX_PERMISSIONS` 时恢复真实 chmod。依赖准备脚本校验源码、应用补丁、记录补丁指纹，许可文件明确说明本地修改。测试覆盖可执行位进入 Git tree，以及 checkout 恢复权限位。该设置不推广到 SAF/FAT 外部存储。

### libgit2 内部线程回调

本地 pack/clone 会从 libgit2 自建线程调用进度和取消回调。最初复用调用线程的 JNIEnv 导致设备 JNI 检查终止进程。桥接已改为保存 JavaVM 和全局 callback 引用；每个回调取得当前线程的 JNIEnv，必要时 Attach/Detach，避免跨线程使用局部引用。修复后 instrumentation 和 Hermes 的本地 pack/clone 均通过。

### 可重建构建

原生依赖归档和补丁分别校验；Windows 文件监听可能阻止目录 rename，因此准备流程在固定 vendor 范围内复制已校验内容，最后写 readiness marker，中途失败不会被标记完成。Metro、ESLint、Prettier 排除下载源码与 native 构建目录，避免工具扫描第三方 fixture 与生成文件。

## 4. 后续仓库模型决策

以下为接入阶段的设计决定，尚未添加没有调用者的生产接口。

| 模型                 | 决策与原因                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| HEAD                 | 区分 unborn、symbolic branch、detached；空仓库不制造虚构初始提交，修改时同时核对引用身份和 OID                      |
| Commit               | `parents` 为数组，保留 author/committer；分页必须支持提交 DAG，第一父链仅作为可选展示方式                           |
| Index                | 表达 path、OID、mode 与 stage 0/1/2/3；冲突版本可缺失，不能假定每个冲突都有三个 blob                                |
| Conflict             | 以冲突索引为事实来源，markers 只是呈现方式；增加/删除、二进制和涉及多个路径的重命名需单独表达                       |
| Tree entry           | 区分普通文件、可执行文件、symlink、gitlink；不再统一重写为 100644；本轮尚未验证 submodule                           |
| Status/diff          | 原生查询并分页/按需读取；禁止为了显示状态先把全仓 bytes 传到 JS，也不沿用编辑器的文件大小限制                       |
| Repository operation | 明确 merge/rebase 等进行中状态及 continue/abort；应用日志记录意图和进度，不覆盖 Git 自身事实                        |
| Application metadata | 项目/任务/草稿元数据移出仓库根目录，停止占用仓库自己的 project.json；作者/remote 按正常 Git 配置处理                |
| Path/authorization   | 保留真实路径的大小写与 Unicode 表示；仓库兼容校验与 Agent 授权分开；新增 symlink 后需要在原生打开文件时阻断越界跟随 |
| Object identity      | 业务接口使用不透明 OID，不把 40 字符假设散落到 UI/用例；支持 SHA256 仍需引擎与仓库专项验证                          |

## 5. 接入顺序与边界

1. 重构上述模型及项目元数据位置，同步替换调用者、测试和文档；保留已有操作日志、任务占用、稳定 operationId 和草稿保护。
2. 实现产品级原生 GitPort，替换移动端旧 adapter；不保留移动端双写或兼容接口。Web 维持独立平台 adapter，明确能力差异。
3. 先交付标准本地暂存/提交/分支/提交图与可核对恢复，再接 HTTPS 凭证、clone/fetch/push 与 upstream。
4. 接入冲突编辑、merge/rebase continue/abort；Git 与 SQLite 不承诺跨存储事务，push 返回结果未知需远端核对。
5. 在 macOS 完成 iOS 原生编译和设备验证；之后补 SSH、stash、cherry-pick、revert、reset、reflog 等。

当前明确未验证：认证 HTTPS push、SSH/host key、HTTP CONNECT 代理、iOS 原生运行、生产草稿/Agent 并发保护、磁盘不足、checkout 中途被杀后的产品恢复、断电持久性、真实大仓库性能、LFS/submodule/签名/外部 filters/hooks。已有 fixture 的恢复结果不能替代这些验证。
