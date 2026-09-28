# 统一入口与部署调查

> 日期：2026-09-29
> 证据基线：HAPI submodule `86c88df`；本机 Linux x64，Node 24.21.0，Bun 1.4.2，HAPI 工程固定 Bun 1.4.0。

## 可复用入口

- `cli/scripts/build-executable.ts` 已支持 macOS/Linux 多架构独立程序、嵌入 Web 与原生工具。`build:single-exe` 的顺序是下载 tunwg、构建 Web、生成嵌入资源、编译 CLI；缺少 tunwg 时构建会失败，按原构建步骤补齐即可，无需改源码。
- `cli/src/commands/hub.ts` 已提供前台 Hub、host/port 参数和 SIGTERM 关闭；`commands/runner.ts` 提供 `start-sync` 前台 Runner 和已有后台管理。Runweft 只管理这两个原有服务进程，不接管模型进程。
- `configuration.ts` 支持 `HAPI_HOME`、`HAPI_API_URL`；Hub 支持 `HAPI_LISTEN_HOST/PORT`、`HAPI_PUBLIC_URL`、`DB_PATH`。托管数据可以放在 Runweft 专用根，不读取用户 `~/.hapi`。
- HAPI `POST /api/auth` 交换原有访问令牌为 JWT；Hub JWT 密钥由 `hub/src/config/jwtSecret.ts` 保存在自己数据根的 `jwt-secret.json`。同机 Runweft 服务可复用其 JWT 验证与 uid/ns，不创建登录协议或账号库。
- `/health` 是无认证存活接口，不能代替认证或 Runner 在线；需分别检查。HAPI 现有 Web、REST、SSE 和 Socket.IO 通过统一入口代理，保留原协议。

## 验证与限制

- 已在 HAPI 固定锁文件下安装依赖，按上游步骤下载 tunwg 后，Web、嵌入资源和 Linux 独立程序构建均通过；HAPI 工作树无源码改动。
- 真实独立程序在专用 home 完成 Hub 启动、`/health`（protocolVersion 1）、访问令牌交换 JWT、Runner 注册（1 台在线机器）及退出；没有启动模型。原始证据：`.dev-smoke/hapi-foundation-probe-1m0ejid8/evidence.json`。
- 完整 npm 安装验证会在隔离前缀与 `.dev-smoke/` 专用 home 内进行。原生模型配置不修改；本 Change 不启动模型任务。
- macOS 需通过实际 macOS CI 执行安装和服务验证，Linux 交叉编译不代替该证据。CI 使用源码构建出的候选包，不发布 npm 或 Release。

## 平台验收环境

- 2026-09-29 按 [GitHub 托管 Runner 官方表](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)核对：`macos-15` 为 arm64、`macos-15-intel` 为 x64；Linux arm64 使用 `ubuntu-24.04-arm`。这些标签支持私有仓库。
- 当前 Runweft 仓库为私有、Actions 已启用；HAPI fork 为公开，CI 可以取得固定 submodule，无需增加或搬运用户模型凭据。
- 工作流在 Linux 构建同一批候选 tarball，先完成 Linux x64 安装，再交给两类实际 macOS 及 Linux arm64 安装；只上传候选包与不含凭据的 evidence.json。设置工作流不等于平台验收通过，运行结论单独记录。
