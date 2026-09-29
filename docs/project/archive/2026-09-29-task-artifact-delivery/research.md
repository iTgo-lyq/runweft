# 任务附件调查

> 更新：2026-09-29
> 调查基线：Runweft `499f265`，HAPI `5341b084c8650b739cd2afcda761023255326150`。
> 以下为实施前源码调查；后续实现和真实传输验证见 [Execution](execution.md)。

## 可复用能力与缺口

| 现有入口 | 已确认事实 | 本次选择 |
| --- | --- | --- |
| HAPI `hub/src/web/routes/sessions.ts` upload | 要求 active session，整块 base64，经 session RPC 写到执行机 | 保留原行为；不能用它准备启动前输入或保存中心唯一成果 |
| HAPI `cli/src/modules/common/handlers/uploads.ts` | session 临时目录、50 MiB Buffer、进程退出清理；保留逻辑服务于原生待消费输入 | 不作为任务持久存储 |
| HAPI `hub/src/scratchlistAttachments/storage.ts` | 在 HAPI_HOME 下持久保存中心文件，读写以 Buffer 为单位；路径和清理由 namespace/session/attachment 关联 | 借鉴存储根、原有授权和文件验证方式；不把任务对象塞进 scratchlist，不复用可能碰撞的 sanitize namespace 存储键 |
| HAPI `cli/src/modules/common/attachmentFile.ts` | 已有同一 fd 的 O_NOFOLLOW、regular file、长度与增长检查 | 复用合适的安全文件读取模式；大文件需流式读写，不直接沿用固定 50 MiB Buffer 接口 |
| HAPI `hub/src/web/routes/cli.ts` | CLI Bearer token 已核对 baseToken 并得到 namespace；不要求会话 | Runner 传输走同一 `/cli` 认证，不建立第二套凭据或 JWT 交换协议 |
| HAPI `hub/src/web/server.ts` | `/api` JWT 中间件；Bun HTTP 当前 body 上限至少 68 MiB，idle timeout 至少 30 秒 | 二进制路由流式处理，并配套设置 body 上限；不能只放宽对象 schema 却被 HTTP 拒绝 |
| Runweft `src/proxy.ts`、`src/hapi.ts` | 反向代理不缓冲文件；HapiClient 当前只有 JSON 请求和默认 10 秒超时 | 字节沿原代理转发；在同一客户端补原始 response/stream，不用 JSON/base64 包装或重复认证 |
| HAPI `cli/src/runner/workspaces/manager.ts` | prepare 接受已落地文件 path/hash/size，复制到受控目录；launch 再检查输入；操作持久受理后 inspect | Git 准备继续消费本地文件。共享目录也需输入准备凭据，复用 Runner 启动前校验层，原生 adapter 不改造 |
| Runweft `src/tasks/coordinator.ts` | shared 当前直接 ready；worktree preparing/finishing；停止确认后才封存 Git，resume 可带准备引用 | 插入输入准备和文件交付步骤，继续沿原有轮次与原生事实，不新建任务执行器 |
| Runweft `src/tasks/store.ts` | 原请求指纹、parent 归属、中心 namespace、串行轮次和 SQLite 已实现 | 附件参数进入请求指纹；业务关联在本数据库，字节唯一权威留在 HAPI |

## 方案推导

已有两条上传能力不能覆盖 session-free、校验发布、不可变引用、流式大文件与引用保留。这是 HAPI 的通用持久文件缺口，放在配套 HAPI 仓库独立提交。Runweft 提供上层命令、任务关联和清单，不另开文件服务器或对象数据库。

文件传输可能超过 RPC/JSON 请求超时。机器 RPC 只快速接受固定文件操作并提供查询，字节通过已认证 Hub HTTP 流动。异常时查原回执，不把传输超时翻译为模型失败。

本地和同机 Hub 可用专用配置、真实 Runner、Codex/Claude 完整闭环。真实远端网络/独立机器仍依用户授权目标留到后续；同机断网试验只证明故障行为，不证明跨机部署。

## 评审后的补充核对

- HAPI WorkspaceRequest.prepare 的 input.name 当前只允许 ASCII；T2 会与 materialize 共用安全 Unicode 名称 schema，避免中文/空格在 worktree 失败。
- 既有 validatePrepared 已检查复制后的 inputs；materialize 不应绑定尚未创建的 checkout cwd。shared 新增 preparedFiles，worktree 继续单用 preparedWorkspace。
- 当前 wait 终态比较 completedRevision，pending 只扫描未结束轮次；附件发布需要独立结果 revision 和已结束轮次文件操作扫描。
- Claude 既有 blobs 目录在系统 tmp 下，不符合本次持久数据布局，不能把唯一输入搬回那里。commands/claude.ts 已接收 --add-dir，sdk/metadataExtractor.ts 白名单保留它，SDK query 也有 additionalDirectories。Runner 可沿原通道传本轮准备目录；实际访问权限在 T2 模型探针验证。
- `.dev-smoke/artifact-stream-probe/evidence.json`：72 MiB 流在 Bun 68 MiB body 上限下返回 413（handler 收到 0 字节），512 MiB 上限下流式落盘成功，独立 sha256sum 与网络摘要一致。这仅是 Bun HTTP 原型；T1 仍须经过正式 CLI、HAPI、代理和存储。
