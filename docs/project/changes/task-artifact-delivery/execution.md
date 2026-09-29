# 任务附件执行概况

## Plan 辅助评审与主审结论

- 执行者：当前工作区 `iclaude`，会话 `0029f242-a0be-4615-991f-48052e58ceb4`；2026-09-29 19:36–19:46（Asia/Shanghai）。进程退出 0，结果 subtype=success、isError=false。仅 Read/Glob/Grep，无 MCP、无实现修改；原文 `.dev-smoke/reviews/task-artifact-delivery/review.md`，metadata/events 同目录。不重复评审。
- 主审结论：可实施，按用户持续授权采纳下表修正后进入逐任务执行。评审时只有文档和底层流式原型；后续实现与验证按任务记录，完整附件能力尚未交付。

| 意见 | 独立核对与处理 |
| --- | --- |
| worktree 中文/空格输入名失败 | 采纳；当前 shared schema 确为 ASCII，T2 统一安全 Unicode 名称，不在 CLI 悄悄改名 |
| preparedFiles 与 worktree cwd/校验重复 | 采纳；主审亦独立发现顺序矛盾。materialize 不绑定 cwd，shared 用新凭据，worktree 单用既有准备/校验并回收下载中间副本 |
| 补交后 wait 与 pending 不工作 | 采纳；当前代码证实 completedRevision 与扫描条件限制。增加 artifactsRevision，保持原完成版本和终态 status，attention 单独说明交付问题 |
| Claude 仓库外输入可能重复审批 | 采纳提前实测；源码已有 --add-dir/claudeArgs 白名单。T2 真实探针决定是否沿原参数提供本轮输入目录，不改默认 permissionMode/runtime 循环，不把整个 home 加入范围 |
| 不可变清单与释放状态冲突 | 采纳；内容版本不可变，留存状态独立，读取按实时对象事实。主审另明确 deleting 状态以保持删除/pin 一致性 |
| 全局 body ceiling 与固定总超时 | 采纳；提高 Bun ceiling 同时保留其他 HTTP 路由上限，文件只用空闲超时与取消，真实限速验证；已有 72 MiB 底层原型证据不代替正式服务验收 |
| 代理 413/配置与 MCP 路径 | 采纳可操作代理提示与部署示例；MCP 只操作 cwd 内路径，CLI 显式路径沿用户权限。未实测各宿主的 MCP 进程沙箱，不把“全部运行在沙箱外”作为既定事实 |
| 自动对账孤立 pin | 部分采纳；pin 前记录本中心接受意图，服务开放前核对该意图，确定未接受才释放。不因任意引用在任务表中不存在就删除，保留未知来源/恢复 pin；无需用户手工维护普通孤立请求 |
| 自动清成功副本、配置分组、命名 | 采纳；成功 spool 和 worktree 中间副本回收，失败候选保留；server.artifacts 分组；清单 delivered/incomplete/none，release/prune 都默认预览加 --apply |
| --input 隐式路径自动上传 | 不采纳本次隐式混合语法；显式 artifact upload 返回稳定可复用对象，再按 ID 引用，避免 UUID/路径歧义及任务重试时自动重新读取已变文件。未减少文件或任务能力 |
| T2/T4 与 T5/T6 调整 | 采纳；T2 专注输入与原生读取，capture/deliver 放 T4 完整输出切片；T3 不提前暴露 --output；T5 先完成留存和部署，T6 在最终组合上做 MCP/安装矩阵 |
| Git 输出与轮次选择 | 采纳说明未忽略输出进入 Git 封存及 Git attention 阻塞文件交付；release 无 round 时先预览全部已结束轮次 |

## T1 无会话的中心文件与 CLI

- 结果：HAPI SQLite schema 28 保存 namespace 文件对象、请求指纹与留存引用，独立于会话；流式发布验证长度/SHA-256，fsync/rename 后开放读取，已发布不可覆盖，删除留墓碑。断流和已落盘未确认的发布可按原 request ID 恢复；配额预约、pin 与删除原子判定。JWT/CLI token 共用同一存储服务。Runweft 提供 artifact upload/show/lookup/list/download/refs/remove/limits 和 server.artifacts 配置，数据在托管 HAPI 数据根；下载默认不覆盖，传输可取消且无固定总时长限制。
- 验证：root `bun test ./test` 104 pass；随后新增非 JSON 413 提示用例，`bun test ./test/artifacts.test.ts` 5 pass、52 assertions；`bun run typecheck` 通过。HAPI 跨包 typecheck 通过，fixturegen 无差异；Hub 1402 pass/3 skip、Web 3249 pass、Shared 323 pass、Relay 118 pass。文件聚焦用例覆盖错误 hash/长度、配额、命名、空文件、断流、恢复、引用竞争与控制接口大小限制。
- 编译与真实服务：配套 Linux x64 runweft/hapi 构建成功。`bun run test:artifacts` 使用编译 CLI 和专用 local/同机 Hub，分别上传/下载 72 MiB 并独立比对 hash；禁用 Runner 且没有原生会话。真实 HTTP 收到 3 字节后断开，再以原请求恢复同一对象；验证实际 JWT/CLI token、跨 namespace 404、引用保护与删除墓碑、重启后读取。连续传输 13.2 秒通过普通 JSON 10 秒超时边界。证据 `.dev-smoke/artifact-cli-kwDCIB/evidence.json`，success=true、cleanupErrors=[]。四平台候选安装留至 T6，不把此次同机验证称为跨机验收。
- 已知验证限制：HAPI CLI 全量 2984 pass/11 skip/1 fail；唯一失败为 `skills.test.ts` 的非 Git cwd 用例，现有 `/tmp/.git` 使其继承父工程 skill，与本任务无关且此前已记录。未删除该目录或修改无关测试。各检查完整日志在 `.dev-smoke/artifact-t1-*.log`。
- HAPI：独立 Commit `Add persistent namespace files with verified streaming and retention references`（`61f42c3a140bccad6a5a3128892ac8bc2f4d5b47`），root pin 已同步。
- 后续：T2 接通机器输入与原生读取，T3–T6 才接任务/MCP、输出和留存清理；本任务没有提前暴露这些能力。
- Commit：`task-artifact-delivery T1: ship verified session-free file storage and CLI`

## T2 机器输入准备与原生读取门禁

- 结果：既有机器 HTTP/RPC 接通 materialize/inspect/release，Runner 在连接 HAPI 数据根保存回执和输入；异步受理、流式核验、取消与断线失败可查询，同请求显式重试，释放后不能复活。shared 的 preparedFiles 贯穿请求指纹、Hub metadata/adoption、RPC 和 Runner 启动门禁；worktree 继续使用 prepare.inputs/preparedWorkspace，统一支持安全中文/空格名称且拒绝重复名称。输入释放要求关联执行停止，启动前缺失/摘要错误/已释放均返回 childStarted=false。Claude 仅通过已有 --add-dir 接收本次输入目录，未改 runtime 循环和权限模式。
- 续接：省略 preparedFiles 继承原绑定，新引用替换，显式 null 清除以支持无新附件的下一轮；确定的输入拒绝保留 archived 与旧绑定。Runweft ExecutionClient 透传此契约。真实探针发现 RPC 原有错误码过滤漏传 files_not_prepared，已补齐并新增 RPC 边界回归，不能将确定拒绝误报为结果未知。
- 原生验证：`bun scripts/smoke-inputs.ts --source hapi/cli/dist-exe/bun-linux-x64-baseline/hapi` 通过，两 runtime 各两轮真实读取准备文件中的随机值、加载项目指令；第二轮保持同一 HAPI/native session，受控子执行仍禁用 runweft MCP。已释放输入续接失败，无输入显式清除后正常续接。证据 `.dev-smoke/inputs-native-g80VEV/evidence.json`，success=true、cleanupErrors=[]，记录的四个执行 PID 均已退出。测试未传权限覆盖；Codex 继承本环境实际 yolo，Claude 为原生 default，不把此证据宣称为 Codex 严格沙箱验证。
- 编译验证：独立 HAPI Commit 后更新 root pin 并构建配套 Linux x64。`bun run test:inputs dist/runweft dist/hapi --machine-only` 通过真实 72 MiB Hub→Runner 下载、重启查原回执、worktree 准备中文/空格名输入、释放中间副本后 worktree 文件 hash 不变、未执行工作区封存与清理。证据 `.dev-smoke/inputs-native-yvvmnc/evidence.json`，success=true、cleanupErrors=[]；没有启动模型。不重复已通过且代码未变的模型轮次；最终四平台组合安装仍在 T6。
- 检查：root typecheck 通过、全量 105 pass；HAPI 跨包 typecheck 通过、fixturegen 无变化。CLI 聚焦 69 pass，覆盖真实文件/HTTP 断流取消、重启未知状态、hash/路径/引用门禁及 Git 输入；CLI 全量 2990 pass/11 skip，唯一失败仍为已记录的 `/tmp/.git` 导致 skills 非 Git 用例失败。Web 3249 pass、Shared 323 pass、Relay 118 pass。Hub 全量 1404 pass/3 skip/1 fail，失败为新增可选位置参数后的旧调用断言；修正该断言并补 RPC 错误码回归后，受影响 Hub 三组共 69 pass/253 assertions。日志 `.dev-smoke/artifact-t2-*.log`。
- HAPI：独立 Commit `Prepare persistent machine inputs before native spawn and resume`（`96acb4c1fce3badd7b79077caf6c055b64a8c467`），root pin 已同步。
- 后续：T3 接通实际 task spawn/next 输入、任务引用与接受意图；当前机器准备接口不等于任务附件业务已交付。
- Commit：`task-artifact-delivery T2: prepare machine inputs before native execution`
