# Agent Mobile

手机端本地 Agent harness：在应用私有工作区中管理文字与图片，通过受控工具执行任务，并使用 Git 保存文件历史。

## 当前状态

已初始化 React Native + Expo Development Build + TypeScript 工程、Expo Router、启动页、基础依赖和领域接口。

文件管理、数据库适配、libgit2 桥接、模型请求和任务执行尚未实现。启动页是静态空状态，不代表已经存在可用的工作区服务。Web 用于界面预览；完整产品以 Android/iOS 原生构建为准。

详细设计、实施阶段和验收条件见 [docs/design.md](docs/design.md)。初始化检查结果与限制记录在 [docs/validation.md](docs/validation.md)。

## 开发环境

- Node.js：满足所选 Expo SDK 的要求，当前初始化环境为 24.11.0。
- npm：仓库使用 npm 和 package-lock.json；安装使用 npm ci。
- Android：Android Studio、SDK、兼容的 JDK、NDK 和 CMake（React Native 的原生依赖也可能需要它们）。
- iOS：macOS + Xcode，或配置 Expo 的云构建服务。

当前固定 Expo SDK 57，版本由 package.json 和锁文件管理。新增 Expo 包使用 npx expo install。

## 启动

```sh
npm ci
npm run android
```

首次 Android 启动会生成原生工程并编译 Development Build。后续只修改 TypeScript 时，可使用：

```sh
npm start
```

在已安装的开发客户端中连接 Metro。新增原生依赖或修改插件配置后，重新运行 npm run android。iOS 在 macOS 上使用 npm run ios。

仅预览界面：

```sh
npm run web
```

## 检查

```sh
npm run check
npx expo-doctor
npx expo export --platform web
```

Web 导出不验证移动端权限、后台运行、SQLite 原生持久化或 libgit2。原生功能实现后必须在模拟器和真机上验证。

## 目录

```text
src/app/             Expo Router 路由与启动页
src/theme/           界面配色
src/core/workspace/  受控工作区接口
src/core/git/        Git 版本操作接口
src/core/agent/      任务和执行记录类型
src/core/model/      模型事件与适配接口
src/adapters/        平台实现边界，当前仅说明文档
modules/             本地原生模块预留，当前未集成 libgit2
docs/design.md       产品与技术设计
docs/validation.md   初始化验证与限制
```

## 配置与凭证

应用标识暂定为 com.agentmobile.app，上架前应改成拥有的标识。图标和启动图暂时保留 Expo 模板素材。

首版设计采用用户自带模型 API Key，后续在 SecureStore 中保存。不要把凭证写入源码、EXPO_PUBLIC_*、Git、日志或生成网页。若提供统一模型额度，将开发者密钥保存在服务端。

android/、ios/ 由 Expo Prebuild 生成并被 Git 忽略；持久原生修改应放在 modules/ 和 config plugin。首次接入 libgit2 时需补充两端构建、自动链接和许可说明。
