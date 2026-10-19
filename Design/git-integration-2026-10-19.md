# Git 接入范围与验收

- 更新时间：2026-10-19T17:56:09+08:00。
- Git 代码基线：`414863fdcd788534b2232fea740024864a8726a4`；本次验收对应这次实现提交。

## 本次范围

保留移动端 libgit2 正式引擎、本地文件与版本管理、暂存/提交/差异/历史恢复、分支/标签/身份、HTTPS clone/fetch/push、上游与认证、进度/取消/未知结果核对，以及 merge/rebase、三方冲突、继续/跳过/中止和中断恢复。Web 保留独立 isomorphic-git 适配与明确的能力边界。

用户明确将 SSH 等高级能力移出本次实现清单，并选择移除新加入的 cherry-pick/revert。对应原生方法、领域类型、应用服务、界面入口、会话桶调用、专项测试与脚本已经删除；不保留兼容别名、占位接口或自动继续扩展的清单。stash、reset、reflog 也不纳入本次交付。

保留受控相对路径、项目权限、基础版本校验、Git 对象日志和恢复机制。根目录 project.json 不再被应用占用，项目业务元数据保存在 SQLite；空仓库保留 null HEAD，不制造提交。当前数据标识为 agent-mobile-f7，操作格式为 schemaVersion=3，不提供历史格式迁移。

## 验收清单

- [x] 正式原生 GitPort、真实文件/模式/符号链接与受控路径边界。
- [x] 本地 Git、分支切换日志、草稿/未提交保护、标签与身份界面。
- [x] HTTPS 认证、克隆发布、获取/推送、上游、取消及未知结果核对。
- [x] 合并/线性变基与共用三方编辑、继续/跳过/中止及恢复。
- [x] 删除范围外高级扩展与误跟踪的测试生成回执。
- [x] 收敛后的全量源码检查、Android 原生/应用/界面验收及 Web 回归。
- [x] 提交审查：无凭证、下载源码、生成原生工程、构建产物或临时导出。

## 本次验证

以下结果均来自移除范围外扩展后执行的本轮验证。证据保存在忽略目录 work/native-git，不提交设备数据、测试仓库、日志或构建产物。

| 检查                                    | 覆盖范围                                                       | 结果                                                                            |
| --------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| npm run check                           | TypeScript、ESLint、Vitest                                     | 通过；40 个测试文件、303 项测试，见 scope-final-check.log                       |
| Android Debug/原生测试 APK              | 当前 x86_64 应用/测试 APK、ARM64 Git 模块编译                  | 通过；见 scope-android-build.log、scope-arm64-build.log                         |
| Android 正式接口与隔离测试              | 文件、仓库、合并/变基、TLS、取消与恢复                         | 通过；正式接口 17 项，隔离探针及证书拒绝通过，见 scope-native-tests.log         |
| AppServices 两进程验证                  | 真实 SQLite/Hermes/原生 Git 与凭证                             | 通过；见 scope-application.log、application-summary.json                        |
| 手机 Git 界面                           | 分支/身份/标签、合并/变基冲突与继续/跳过/中止                  | 通过；见 scope-repository-ui-retry.log、scope-merge-ui.log、scope-rebase-ui.log |
| HTTPS 传输与标准 Git 互操作             | 认证推送/获取、上游、版本拒绝、未知结果核对、标准 Git 继续变基 | 通过；见 scope-remote.log、scope-rebase-interop.log                             |
| Web 导出与 Git 回归                     | 本地工作流、仓库界面与平台能力边界                             | 通过；4 项回归，见 scope-web-build.log、scope-web-ui.log                        |
| Expo Doctor、Prettier、git diff --check | 配置与提交检查                                                 | 通过；Doctor 21/21、全仓格式、工作区及暂存 diff 检查通过                        |

Expo Doctor 首次网络检查失败，重试后 21/21 通过。基础仓库 UI 首次等待开发客户端的“设置”入口超时；随后 UI dump 已显示真实工作台，未修改脚本及超时门槛，重新运行后全部通过。合并与变基 UI 使用本轮新建的自有 fixture，均通过。

## 平台与能力边界

当前环境为 Windows 与 Android 模拟器；ARM64 交叉编译不等同真机运行，iOS 源码/构建配置不等同 Xcode 与设备验收。iOS 与真机证据继续明确标注为未验证，不以它们为由继续扩展本次功能。LFS、递归 submodule、任意 hooks/filters、签名、代理和大仓库资源测量不在本次验收声明中。

稳定技术契约见 [原生 Git](../docs/native-git.md)、[工作区与 Git](../docs/workspace-and-git.md)、[存储与恢复](../docs/storage-and-recovery.md)。此前的可行性、合并与变基阶段记录分别保留在相应 Design 文档中，仅作历史参考。
