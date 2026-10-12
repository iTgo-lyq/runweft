# 统一 CLI 与部署执行概况

## 一次 Plan 评审

- 评审者：当前工作区 iclaude，会话 `16a8a0bc-ebe9-4146-b67e-db34767a6288`；2026-09-29 完成，退出码 0，结论“小幅修正后即可执行”。原始材料在 `.dev-smoke/reviews/unified-cli-and-deployment/`。
- 采纳：显式控制 HAPI 部署环境变量、关闭托管 Runner 版本 handoff、区分本地/Hub 服务端/Hub 客户端操作、补公开 URL 和 Web 登录入口、真实 registry 安装验证、Node 启动器信号转发、私有 HAPI 端口自动选择。
- 独立判断：不全面禁用 HAPI 域，只阻止覆盖同一托管服务；停止使用本机归属核对，无需新增远端管理权限；工作区绑定用 SQLite 唯一约束代替手写 JSON 文件锁。
- 不另开产品确认：用户已授权自主实施与验收；npm 包名/自身许可的公开发布事项留到集成发行，本 Change 只生成和测试候选包。

## T1 配置、工作区绑定与可运行 CLI

- 结果：已有独立 CLI 可生成/保留 YAML 配置、编辑并校验字段、显示生效来源与数据路径，以 SQLite 持久绑定真实目录和 Git 根；无效配置仍可查询文件位置。
- 验证：`bun run typecheck`、`bun run test`（9 项 / 41 断言）、`bun run build` 通过。编译后的程序在专用 home、PATH 不含 Bun 的情况下完成 init、幂等 init、config check、paths 和跨进程稳定 workspaceId 验证。
- 修正：初次使用 `bun test test` 被 Bun 当成名称过滤而包含 HAPI 测试，已中止并改为 `bun test ./test`；不把该误跑结果计为验证。HAPI 工作树保持干净。
- Commit：`unified-cli-and-deployment T1: add configuration and workspace CLI`

## T2 复用 HAPI 的双模式服务与认证

- 结果：统一程序托管原有 Hub/Runner，提供本地和 Hub 客户端启停、前台中心部署、认证、Web 登录入口、版本/路径诊断及 HAPI 参数和信号透传；上层 HTTP 路由复用 HAPI JWT，原生 Web/SSE/WebSocket 通过同一地址访问。
- 验证：类型检查与构建通过；12 项聚焦测试、54 个断言通过，含原样 argv、退出码、SIGTERM 转发与纯 HAPI 地址误配诊断。`node scripts/smoke-service.mjs` 使用编译程序和真实 HAPI，完成两模式的认证/Runner 注册、完整代理协议、幂等启动、重启身份保留、独立连接存储、停止和信号清理、无 Runner 的前台中心，并覆盖 localhost 配置。证据：`.dev-smoke/service-etZM8p/evidence.json`。
- 修正：复用 HTTP 连接后升级 WebSocket 在 Bun 兼容层停滞，已让普通 HTTP 响应结束后关闭连接；HAPI 机器在线缓存延迟过期，改为结合本机原有 Runner 状态；构建用原子替换复制 HAPI，避免覆盖运行中的二进制失败。HAPI 源码未修改。
- 范围：测试均使用专用 home，无真实模型任务或跨机远端验证。正式 npm 依赖安装与 macOS 验收继续由 T3/T4 完成。
- Commit：`unified-cli-and-deployment T2: manage HAPI services through one CLI`

## T3 平台包与安装路径

- 结果：已有固定源码的 HAPI 构建脚本、四个平台的 Runweft/HAPI 二进制包、带信号转发的 Node npm 启动器、源码及许可材料、可跨机器使用的包索引。产物在 `dist/packages/`；候选包保持 private，没有公开发布。
- 验证：类型检查通过；macOS arm64/x64、Linux arm64/x64 均实际完成交叉构建与 npm pack。临时 registry 的真实 `npm install --global` 自动安装主包和 Linux x64 可选依赖，在无 Bun 的 PATH 与独立消费目录完成全部 T2 服务流程、前台启动器信号、缺包诊断、npm 卸载及持久数据保留。证据：`.dev-smoke/install-SsdXG8/evidence.json`。
- 限制：交叉构建不是 macOS 或 Linux arm64 的运行验收；T4 使用实际平台运行同一候选包。公开包名占用/发布权限及自身许可在集成发行处理，不以当前 registry 查询未占用承诺将来可发布。
- Commit：`unified-cli-and-deployment T3: package standalone platform distributions`

## T4 平台验收配置与操作文档

- 结果：添加固定 Actions revision 的工作流，同一 Linux 构建批次由 macOS arm64/x64 与 Linux arm64 运行 npm 安装和服务验收；补齐基础安装、三种机器角色、配置切换、数据备份、升级和诊断说明。
- 验证：工作流结构与官方平台标签已核对；使用 T3 已通过的真实 npm 安装脚本，不增加模型凭据、不发布公共包；文档链接、Change 结构和 diff 检查通过。
- 计划调整：原 T4 分成配置/文档交付与 T5 实际平台验收。CI 需要先取得提交后的代码，当前提交不表示 macOS 已验证成功；运行证据由 T5 收回。
- Commit：`unified-cli-and-deployment T4: add platform acceptance CI and operations guide`

## T6 公开依赖源修正

- 证据：首次 [CI 36478758984](https://github.com/iTgo-lyq/runweft/actions/runs/36478758984) 在根依赖安装时失败；锁文件包含本机内部镜像 URL，GitHub Runner 无法解析。尚未进入平台验收，不计为通过。
- 结果：项目显式使用公开 npm，锁文件只更换镜像前缀，包版本和 integrity 保持不变；不修改用户全局 npm 配置。
- 验证：`.dev-smoke/public-registry-install/` 在独立空缓存下执行公开源 `bun install --frozen-lockfile` 成功。
- Commit：`unified-cli-and-deployment T4.1: use public dependency sources for CI`

## T5 实际平台与整体验收

- 结果：[CI 36478994571](https://github.com/iTgo-lyq/runweft/actions/runs/36478994571) 在提交 `846caf386670997aca854bfee051c2ccf54a4712` 上全部通过。构建、类型检查、12 项测试及 Linux x64 安装通过；同批 tarball 在 macOS arm64/x64 和 Linux arm64 的实际 Runner 上安装并运行成功。
- 证据：已下载并逐一读取四个平台各两份 `evidence.json`，全部 `success: true`；原件保留在 `.dev-smoke/ci-36478994571/evidence-<平台>/`。CI artifact 仅保存非秘密摘要，不上传测试 home、日志或凭据；artifact 有保留期限，本文保存持久结论和运行定位。
- 验收方式：依据用户逐 Change 自主验收授权，主 agent 核对以下需求映射；无需再次安排用户手工测试。没有新增实现变更，不重复已通过的完整构建与平台测试。
- Commit：`unified-cli-and-deployment T5: accept four-platform installation and services`

| Requirement 验收项 | 可观察证据与边界 |
| --- | --- |
| 单一安装与操作入口 | 四个平台真实 npm 全局安装自动解析可选平台依赖；仅 Node/系统工具 PATH 下运行服务、透传 HAPI 参数和版本，不依赖 Bun 或源码目录 |
| macOS 实际安装 | `macos-15` arm64、`macos-15-intel` x64 运行安装脚本成功；不是交叉构建推断，尚不包含模型协作 |
| 公共命令、配置、服务及认证承载 | CLI 命令注册、统一 HTTP 路由和目录已实现；真实 HAPI JWT 访问 Runweft identity，匿名返回 401；不预建下游业务表 |
| 本地与 Hub 模式 | 本机组合启停、独立 Hub 客户端认证和 Runner 注册通过；客户端停止后中心仍存活；连接目录和机器身份互不混用。该单机协议验证不等于远端协作 |
| 配置与持久数据 | 聚焦测试覆盖默认值、注释保留、环境优先级、无效编辑及稳定目录绑定；重启保留令牌、机器与 workspaceId；附件和 worktree 待所属 Change 实现，届时使用已确定的数据归属 |
| 自动验收及保留 | 安装和服务脚本自动完成；npm 卸载后保留服务数据，SIGTERM 后托管端口关闭。用户原有客户端 home 与 HAPI 数据未修改 |
| 故障与兼容诊断 | 缺少平台包、配置错误、纯 HAPI 地址误配有明确诊断；status 区分已安装/运行版本，doctor 核对固定 HAPI/协议和本机 Runner；无切换执行目标的兜底路径 |
| 原生配置与权限 | 代码沿原环境启动 HAPI，托管时仅处理部署配置；无新增账号或审批绕过参数；原生配置继承的模型实测归 HAPI 执行契约 Change |
| 输出与日志 | 服务脚本核对普通输出和日志不含测试令牌，非交互 token 输出被拒绝；当前无模型 prompt/源码日志，也无 MCP 服务。MCP stdout 的真实协议验证归宿主适配 |

本 Change 的基础安装、服务与配置能力已达到验收要求。候选包仍为 private，未公开发布；模型执行、MCP、业务工作区、附件及真实远端链路按后续 Change 交付，不能据此宣布完整产品完成。
