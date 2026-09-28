# 统一 CLI 与部署技术方案

> 来源：./requirement.md
> 状态：已确认
> 更新：2026-09-29
> 确认依据：用户授权主 agent 落实工程细节；本方案与 Plan 合并交给 iclaude 做本 Change 唯一一次评审，采纳情况记入 execution.md。

## 交付形态

使用 TypeScript/Bun 构建 Runweft 独立可执行程序，与固定 HAPI 源码构建出的原有独立程序一起放入平台包。npm 主包只有 Node 启动器和对应平台可选依赖；另生成含当前平台二进制的自包含 npm tarball，供发布前安装验收。支持 macOS arm64/x64 和 Linux arm64/x64。最终用户无需安装 Bun 或第二个 CLI。

HAPI 的源码、原生适配、Web 和协议沿 submodule；Runweft 不复制其源码进 src，不改造 Codex/Claude launcher。包内保留 HAPI 许可、NOTICE、源码 URL 与固定 revision。具体构建步骤见 [Research](research.md)。

## 命令与配置

基础命令为 `init`、`config show/path/check/set`、`paths`、`workspace bind/list`、`start/status/stop`、`serve`、`doctor` 和 `hapi …`。业务命令在所属后续 Change 增加，当前不显示占位命令。

默认配置为 `~/.runweft/config.yaml`；`RUNWEFT_HOME` 或全局 `--home` 可覆盖根。YAML 提供带说明的默认示例；模式默认 local，Hub 连接必须显式填写 URL。字段限定为 schemaVersion、mode、server（host/port/hapiPort/runner）、hub（url/tokenEnv）和 hapi（executable 可选）。未知字段与无效值报出路径，不悄悄忽略。`config set` 保留 YAML 注释并先校验；有效值与来源可查询。

令牌优先从所配置的环境变量读取，其次从对应 HAPI 托管 settings 读取；`runweft hapi auth login` 沿 HAPI 交互持久化。配置展示只说明凭据是否可用及来源，不输出值。`hapi …` 通过 argv/继承终端执行原程序，透传退出状态和信号，保留原生模型 home 和权限配置。

## 服务与数据归属

`runweft serve` 在本机前台启动一个 Runweft HTTP 入口和原有 HAPI Hub；默认同时启动原有 Runner。HAPI 只绑定 loopback 私有端口，Runweft 默认入口为 `127.0.0.1:3210`，HAPI 为 `127.0.0.1:3211`。公开 Hub 部署显式设置 server.host，外部 TLS 可由既有反向代理提供。

Runweft 服务使用 Node HTTP 接口与 http-proxy 透传 HAPI 的 HTTP/SSE/WebSocket；自己的路由放在 `/api/runweft/`，复用 HAPI 生成的 JWT 密钥验证 uid/ns。认证仍由 HAPI `/api/auth` 处理。服务代码在本仓库，HAPI 通用能力仍在独立 fork；不向 HAPI 增加 Runweft 业务表。

后续 delegation/round/result、业务资源注册与文件对象在该服务侧落盘：本地模式服务就在本机，Hub 模式就在选定中心部署，CLI/MCP 都通过同一 HTTP 契约访问。HAPI 原生执行事实仍沿 HAPI 查询，不复制会话数据库。本 Change 只确定目录与路由承载，不预建下游表。

| 位置（相对 RUNWEFT_HOME） | 用途 |
| --- | --- |
| config.yaml | 可编辑全局配置 |
| server/hapi/ | 托管 Hub 的原有 settings、JWT、数据库及日志 |
| server/runweft/ | 后续上层业务数据库与对象，不存原生会话副本 |
| connections/local/hapi/、connections/<Hub URL hash>/hapi/ | 当前机器 Runner 的 HAPI 配置、机器身份和日志，与所选连接分开 |
| workspaces.json | 本机真实目录绑定；随机稳定 workspaceId，不用模型自报路径 |
| logs/、cache/、tmp/ | 服务日志、可再生构建缓存与临时数据；唯一成果不能只在 tmp |
| server/process.json | 托管服务定位信息，不存业务任务状态 |

本地模式使用托管服务的既有令牌；Hub 模式只连接已配置的 URL，缺少认证时报错，不回退本地或复制配置。连接身份与 namespace 的资源归属由资源注册 Change 消费 HAPI 已验证身份。

## 生命周期与错误

`start` 后台运行同一 `serve`，等待 Runweft 与 HAPI 健康证据，并检查配置归属；重复启动返回已运行。`status` 明确服务、HAPI 与 Runner 的实际状态；`stop` 经已有认证请求关闭本机托管组合，不按任意陈旧 PID 盲目 kill。前台信号统一关闭托管 Hub/Runner；原生任务进程的控制留给 HAPI。

Hub/Runner 意外退出则服务报错并退出，避免显示虚假的可用状态，不构建无限重试监督器。端口冲突、缺少平台包、配置错误、认证失败分别给出可操作提示。日志只输出服务元信息；托管 Hub 使用已保存的原有令牌，避免首次生成令牌被打印到日志。

`doctor` 检查配置、路径、捆绑 HAPI 版本、所选服务连通和认证，区分环境问题与尚未验证的模型登录。原生工具可发现不等于模型可用。

## 验证

- Bun 聚焦测试覆盖配置优先级/校验/来源、空间路径和符号链接绑定、错误退出、命令 argv/信号、HTTP/SSE/WebSocket 代理。
- 使用真实 HAPI 构建，在专用 home 完成 init → start → 认证 → Runner 在线 → restart → stop；另用独立客户端 home 连接本机 Hub 验证 Hub 模式协议。该结果不冒充跨机远端验收。
- npm pack 后在专用前缀安装，以包内程序完成同一流程，证明不依赖源码路径、全局 Bun 或第二个 CLI。macOS CI 跑同一安装验收脚本。
- 不启动真实 Codex/Claude 任务；它们的执行验证属于下一个 Change。
