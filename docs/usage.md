# Runweft 基础入口使用说明

当前版本交付配置、HAPI 服务管理和安装基础；MCP 安装、agent 定义、任务委派与看板仍在后续 Change 实现，不能把本说明当作完整协作版本已经交付。

## 安装与首次使用

运行环境需要 Node.js 20+。候选包覆盖 macOS arm64/x64、glibc Linux arm64/x64；不需要全局 Bun 或单独安装 HAPI。当前尚未发布到公共 npm，使用提供候选包的 registry：

```sh
npm install -g runweft@0.1.0 --registry <候选包-registry> --include=optional
runweft start
runweft open
```

安装源必须同时提供 `runweft` 和当前平台的 `runweft-<os>-<arch>` 包。主包只有启动器，单独安装主包 tarball 不能代替平台依赖安装。`runweft --version` 可核对版本；找不到平台包时按错误提示重新安装并保留可选依赖。

本地默认入口是 `http://127.0.0.1:3210`，默认数据根是 `~/.runweft`。`start` 自动管理本机 HAPI Hub 与 Runner；`open` 使用该连接的 HAPI 登录打开浏览器。无图形浏览器时，在本机交互终端运行 `runweft auth token`，然后手动访问服务地址登录。令牌不会写入普通状态输出或 JSON。

```sh
runweft status
runweft doctor
runweft workspace bind
runweft stop
```

`doctor` 不运行模型，也不把机器在线视为模型登录已验证。服务停止会保留配置、数据库和原生会话；正在运行的模型会话由 HAPI 管理，停止 Runner 不等于停止所有模型任务。

## 配置

没有配置文件时可以直接使用本地默认值。需要调整时：

```sh
runweft init
runweft config path
runweft config set server.port 3211
runweft config check
runweft config show
runweft restart
```

`init` 保留已有配置；`config set` 保留注释并先校验，失败不覆盖原文件。配置优先级为字段环境变量高于 YAML，高于默认值；`config show` 显示每项生效来源。数据根的全局 `--home` 高于 `RUNWEFT_HOME`，例如 `runweft --home /srv/runweft status`。全局参数写在子命令前。

```yaml
schemaVersion: 1
mode: local
server:
  host: 127.0.0.1
  port: 3210
  runner: true
hub:
  tokenEnv: RUNWEFT_HUB_TOKEN
```

| 配置 | 含义 |
| --- | --- |
| `mode` | `local` 管理本机服务；`hub` 连接指定 Runweft 中心 |
| `server.host` / `server.port` | 本机入口监听地址和端口；本地使用 `127.0.0.1` 或 `localhost` |
| `server.publicUrl` | 对外部署时用户实际访问的 HTTP(S) 根地址，用于公开 URL 与 CORS |
| `server.hapiPort` | HAPI 私有 loopback 端口；省略则自动选择，不与入口端口相同 |
| `server.runner` | 中心是否同时托管本机 Runner；只有中心职责的机器可设 `false` |
| `hub.url` | Hub 模式下的 Runweft 中心根地址，不含路径或查询参数 |
| `hub.tokenEnv` | 保存访问令牌的环境变量名称，不是令牌值 |
| `hapi.executable` | 开发或兼容 fork 的程序覆盖；正常安装无需填写 |

环境变量覆盖入口为 `RUNWEFT_MODE`、`RUNWEFT_HUB_URL`、`RUNWEFT_HOST`、`RUNWEFT_PORT`、`RUNWEFT_PUBLIC_URL`、`RUNWEFT_HAPI_EXECUTABLE`。托管服务的 `HAPI_HOME`、`DB_PATH`、HAPI 地址、端口和访问令牌由 Runweft 管理，忽略同名外部部署设置；模型原生配置环境继续继承。

## Hub 部署

| 机器角色 | 需要安装和运行的内容 |
| --- | --- |
| 中心 | Runweft 配套包，前台 `serve --public`；保存 HAPI 与 Runweft 服务端数据 |
| 主宿主机器 | Runweft 与原生 Codex/Claude Code；Hub 模式连接该中心 |
| 执行机器 | 兼容版本的 Runweft 包、所需原生 runtime 和该账户的模型配置；Hub 模式 `start` 注册本机 Runner |

同一机器可兼任多种角色。纯 HAPI Hub 不包含 Runweft 上层路由，不能直接当作 Runweft 中心；doctor 会明确提示。原生模型 CLI 的认证仍按其原有方式配置，不复制其他机器的 home、skill 或凭据。Runweft MCP 接入在对应 Change 完成后提供，不由当前基础安装暗中注册。

中心保留 `mode: local`，配置公开地址。以下示例假设已有反向代理把公开 HTTPS 地址转到本机 3210 端口：

```sh
runweft init
runweft config set server.publicUrl https://runweft.example.com
runweft config set server.runner false
runweft serve --public
```

`--public` 在默认 host 下监听 `0.0.0.0`；不加该选项的 `start` / `serve` 保持本地模式。公开部署由已有进程管理器运行上述前台命令，发送 SIGTERM 可正常关闭。重启中心应保持 `serve --public` 参数；`runweft restart` 用于本地后台组合或 Hub 客户端 Runner。HAPI 内部端口只绑定 loopback。

在中心另一终端运行 `runweft auth token` 取得访问令牌，再通过已有安全方式交给客户端。客户端操作：

```sh
runweft init --url https://runweft.example.com
runweft auth login
runweft start
runweft status
runweft doctor
```

无人值守环境可配置 `RUNWEFT_HUB_TOKEN`，或用秘密管理工具将令牌通过标准输入传给 `runweft auth login --token-stdin`；不要把令牌写在命令参数或 `config.yaml`。环境变量令牌优先于本连接保存的令牌。

Hub 客户端 `stop` 只停止该机器在当前连接上的 Runner，不关闭中心。不同 Hub URL 与本地模式各自保存连接身份；切换配置不会迁移数据，也不会替用户停止旧连接的 Runner。切换前应先停止当前连接，再配置新地址和认证。

已有本地配置时，`init --url` 不会覆盖它。切到 Hub 的明确步骤是先 `runweft stop`，再 `runweft config set hub.url https://runweft.example.com`、`runweft config set mode hub`，然后登录并启动。切回本地先停止当前 Runner，再设置 `mode local`。

## 数据、升级与诊断

`runweft paths` 给出所有实际路径。相对数据根：

| 目录或文件 | 生命周期 |
| --- | --- |
| `config.yaml` | 可编辑配置；升级保留 |
| `server/hapi/` | 托管 Hub 的原有数据库、令牌、JWT 密钥及状态；备份保留 |
| `server/runweft/` | 上层服务数据位置；当前不预建任务表 |
| `connections/<连接>/hapi/` | 本机 Runner 的连接配置、机器身份和原生日志；各连接分开 |
| `client.sqlite` | 本机真实工作目录绑定；Claude MCP hook 的逐调用身份用后删除，未消费记录保留 24 小时 |
| `logs/` | 托管服务日志；当前由部署方按磁盘需要归档或轮转 |
| `cache/`、`tmp/` | 可再生缓存与临时文件；服务停止后可清理，不保存唯一成果 |
| `server/process.json` | 当前托管服务定位信息；正常停止会移除 |

Codex/Claude Code 的配置和会话历史仍在各自原生目录，工作区源码仍在原处。不要删除整个数据根来修复安装问题。

升级时安装同一批次的主包与平台包，再按角色重启相应服务。`status` 区分已安装与正在运行的服务版本；`doctor` 检查固定 HAPI 兼容版本。更换二进制不自动删除旧数据，也不主动迁移用户已有 `~/.hapi`。有活跃模型任务时先收尾再更新执行组件。

备份前停止对应服务；备份 `config.yaml`、`server/`、`connections/` 和 `client.sqlite`。SQLite 使用 WAL，整个停止后的数据根一起备份最直接。恢复时使用匹配的 Runweft/HAPI 版本；未来数据升级由所属 Change 定义，当前不承诺跨任意版本回退。npm 卸载只删除软件包，数据根需另行管理。

常见排查顺序是 `config check` → `status` → `doctor` → `paths` 所列日志。端口占用先修正 `server.port`；纯 HAPI 地址改为 Runweft 中心；认证失败核对当前连接与令牌来源。错误不会静默切回本地或其他执行目标。

原有 HAPI 命令可通过 `runweft hapi …` 使用，参数、终端、退出码和信号沿原程序传递；覆盖同一托管 Hub/Runner 的操作会提示使用统一启停命令。

## 源码构建和候选安装验收

```sh
git submodule update --init hapi
bun install --frozen-lockfile
bun run build:hapi
bun run build
bun run typecheck
bun run test
bun run test:service
bun run package --all
bun run test:install
```

构建使用固定版本 Bun 1.4.2。`package --all` 生成四个平台的 npm 包和可移交的 `dist/packages/index.json`；`package --platform darwin-arm64` 可只构建一个平台。`--reuse-hapi` 仅在已有匹配源码和 hash 的构建记录时跳过 HAPI 重建。

安装验收启动一次性 registry，并使用 `.dev-smoke/` 下的专用 npm 配置、缓存、安装前缀和数据目录；不改用户的全局 Runweft、HAPI 或模型配置。平台包附有 HAPI 许可、NOTICE、工具许可和对应源码归档。候选包保持 private，不会由构建或 CI 自动发布到 npm。
