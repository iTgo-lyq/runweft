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

## T3 CLI 任务输入与真实原生续接

- 结果：task spawn/send 的重复 --input 支持对象默认名或显式中文/空格名；按轮次冻结对象 ID/名称/hash/大小。state schema 升至 3，先持久化接受意图再 pin，业务接受事务绑定引用；相同 request ID 返回原接受结果，不重复启动。服务开放入口前回收已登记且未接受的引用，保留已接受和外部引用。
- 准备：shared 使用 preparedFiles，worktree 将已校验下载交给既有 prepare.inputs，得到最终路径后释放中间副本；准备完成前不派生模型。路径进入 prompt 和 task show；第二轮新输入替换原生绑定，无输入显式清除，steer 不支持新附件。纯文字请求保持原有指纹。
- 自动验证：root typecheck 通过，全量 111 pass / 2061 assertions；补充未发布对象拒绝后聚焦文件任务测试 6 pass / 128 assertions、最终 typecheck 通过。覆盖真实中心 SQLite/HTTP 引用、并发相同请求、丢响应/重启对账、校验失败无模型、输入替换和清除、worktree 中间副本释放与 parent 归属。日志 `.dev-smoke/artifact-t3-*.log`。
- 原生验证：配套 Linux x64 编译 CLI 的 `bun scripts/smoke-task-inputs.ts` 通过 Codex/Claude × shared/worktree × 两轮，共 8 轮。模型实际读回每轮随机输入与项目指令标记；各组轮次之间重启服务，第二轮仍复用同一 native session。核对输入 hash、真实目录、引用防删除、主仓库 HEAD/状态不变、受控 MCP 禁用 metadata 与每轮停止。证据 `.dev-smoke/task-inputs-YvyIt7/evidence.json`，success=true、cleanupErrors=[]，8 个记录 PID 均已退出。沿专用配置副本继承本环境权限，不将 Codex 的既有 yolo 配置称为严格沙箱验证。
- 构建：`bun run build` 通过；HAPI 源码与 revision 保持 `96acb4c1fce3badd7b79077caf6c055b64a8c467`，无需重复其已通过的检查。四平台安装、Hub/MCP 附件组合仍在 T6；本任务不开放尚未实现的输出参数。
- Commit：`task-artifact-delivery T3: attach frozen inputs to CLI task rounds`


## T4 HAPI 固定输出候选与机器交付

- 结果：HAPI 捕获/交付和机器组合已完成。原 T4 按职责细分为机器交付 T4 与业务清单 T4b，范围不变；版本清单、retry/collect、CLI 输出参数与真实模型组合在 T4b 接通，本任务不提前开放。
- HAPI：现有机器文件接口增加 capture/deliver，分别保存捕获候选和固定上传身份；逐项错误不覆盖其他成功项，停止重启不重新采集旧 cwd。capture 的 names 释放只清选定 spool，正在传输时拒绝释放；候选与工作区生命周期分开。Runner 另声明 artifactOutputs:1，旧输入 Runner 明确拒绝输出。流式复制检查 regular file、目录范围和读取期间变化，上传沿现有认证/原子 pin 预约与发布校验。输入临时文件改用独立随机名，避免和合法的 .part 或 240 字节名冲突。
- 检查：HAPI 跨包 typecheck 通过；Hub 全量 1407 pass / 3 skip，Web 3249 pass、Shared 323 pass、Relay 118 pass；CLI 全量 2996 pass / 11 skip，唯一失败仍是既有 skills 非 Git 用例读取 /tmp 上级工程指令。单独设置 Git ceiling 后该用例仍失败，未改无关生产代码或删除 /tmp/.git。最终附件组 11 pass、CLI typecheck 通过，涵盖 HTTP 发布丢响应、大小拒绝、重启固定候选、逐项清理、路径和输入回归；root typecheck 通过。日志 `.dev-smoke/artifact-t4-*.log`。
- HAPI Commit：`Capture and deliver persistent output candidates without native reexecution`（`8b648f9433d4d7ff0c6d6c8a3c88951bc0f9c38e`）；root pin 已更新。
- 真实验证：`bun run build:hapi`、`bun run build` 与 `bun run test:outputs` 通过。独立 Hub/Runner 专用数据根，无模型：捕获小文件、72 MiB 文件和缺失项，真实服务限额使大文件部分失败，小文件仍发布并受 pin 保护；单独释放小文件 spool，变更原路径后旧 capture 不重新采集；显式新 capture 收集迟到文件。删除工作区、重启 Hub/Runner 并提高服务限额后，同上传身份恢复小文件、交付大候选。停止 Runner 后仍从 Hub 下载两项并核对 SHA-256，成功 spool 已释放，无原生 session。证据 `.dev-smoke/outputs-machine-neErem/evidence.json`，success=true、cleanupErrors=[]。
- 兼容验证：root 输入任务回归 6 pass / 128 assertions、脚本 typecheck 通过；配套构建为 Linux x64，四平台候选安装仍在 T6。
- Commit：`task-artifact-delivery T4: capture and deliver fixed output candidates`


## T7 输出清单、部分交付与文件补交

- 结果：spawn/next 的 --output 声明在原生停止、Git 封存后捕获交付；state schema 4 保存不可变清单版本。task artifacts show/retry/collect 支持按轮次查看、固定候选重传和显式补收，原请求幂等，发布确认后释放成功 spool。文件状态、attention 与原生完成结论分开；artifactsRevision 通知补交，wait 按通知 revision 排序以避免旧轮次补交掩盖新轮次完成。已结束轮次的文件操作参与重启扫描，collect 期间下一轮等待。
- 验证：root 全量 117 pass / 2220 assertions；随后补齐 collect 阻止排队启动和未准备 worktree 拒绝从主目录补收两项，聚焦输出测试最终 8 pass / 190 assertions，最终 typecheck 与编译通过。覆盖真实中心 SQLite/HTTP、部分发布、响应丢失、重启、固定候选、历史版本和原生调用次数；未改 HAPI，复用 T4 机器层证据。日志 `.dev-smoke/artifact-t4b-*.log`。
- 真实执行：`bun run test:task-outputs` 使用配套编译 CLI，通过 Codex/Claude × shared/worktree × 两轮，共 8 轮。首轮降低 Hub 文件限额制造部分交付，恢复限额后重传原候选，再补收遗漏文件，清单生成 v1/v2/v3；原生身份、执行 PID 和 completedRevision 没有因文件操作变化。第二轮复用同一 native session、改写同名输出，旧发布内容仍可下载。核对项目指令、输入/输出内容、引用保护、成功 spool 回收、主仓库无修改、子 MCP 禁用及每轮停止。证据 `.dev-smoke/task-outputs-u3MJua/evidence.json`，success=true、cleanupErrors=[]，8 个记录 PID 均已退出。
- 验证边界：专用配置副本继承原生权限；Claude 的测试文件写入审批按具体命令批准并记在证据中，未改权限模式或用户配置。真实矩阵使用的构建先于最后新增的未准备 worktree 补收门禁，该门禁另有聚焦测试且最终构建已包含；矩阵全部使用成功准备的 worktree，无需重跑模型。Runner 离线下载和 72 MiB 固定候选复用 T4 实测；跨机与四平台安装未在本任务宣称完成。
- Commit：`task-artifact-delivery T4b: publish task output versions and explicit file recovery`


## T5 中心过期清理、用量与部署说明

- 结果：HAPI 的 POST artifacts/prune 默认预览、apply 逐项清理无引用且过期的对象，复用对象锁和引用事务；稳定 ID 游标翻页，部分失败与活跃上传明确列出。清理前恢复已落盘但未发布的对象，并重新检查时间和引用；删除中断可继续，配额仅在字节删除后释放。limits 新增各状态和去重引用用量，Runweft artifact prune/limits/doctor 暴露同一事实及路径、恢复提示；部署文档补齐备份、期限和代理配置。原 T5 按中心对象与业务轮次拆为 T5/T5b，不减少留存范围，未再次评审。
- 验证：root typecheck 通过，全量 120 pass / 2277 assertions；HAPI 跨包 typecheck 通过，fixturegen 无差异，Hub 1410 pass / 3 skip、Web 3249 pass、Shared 323 pass、Relay 118 pass。Hub 聚焦 11 pass / 86 assertions，真实 SQLite/文件/HTTP 覆盖预览、所有 purpose 的 pin、晚到引用、活跃上传、恢复发布后重新计龄、删除故障保留占额、重启继续及稳定翻页。日志 `.dev-smoke/artifact-t5-*.log`。
- 检查限制：HAPI CLI 全量 2995 pass / 11 skip / 2 fail。Claude seam 在全量并发中超时，单独复测 3 pass（未改其代码）；另一个为已记录的 `/tmp/.git` 导致 skills 非 Git cwd 用例失败，未删除环境目录或改无关代码。
- 编译与实测：配套 Linux x64 构建后，`bun run test:artifact-prune` 通过独立 local/同机 Hub 的真实服务、配置、预览、分页删除、配额和 doctor 检查。停止专用服务后只调整测试数据库时间，再启动验证过期对象；自建 HTTP 代理在实际删除后丢弃响应，通过原 request ID 查询准确墓碑，重启后保留。四种 pin 和近期对象未被清掉，受保护对象可下载，原生 session 数为零。证据 `.dev-smoke/artifact-prune-iPItLX/evidence.json`，success=true、cleanupErrors=[]。
- 探针修正：首轮代理探针将 fetch 已解压的响应仍标为 gzip，预览解析失败；清理完整结束，未运行模型。移除测试代理的失真编码/长度 header 后重新验证成功，产品网关无此改动。Nginx/Caddy 等未安装；Nginx 示例已核对官方缓冲、体积和空闲超时文档，未冒称通过 Nginx 实测。四平台候选包仍留至 T6。
- HAPI：独立 Commit `Add explicit expiry cleanup and retained file usage diagnostics`（`c4c432ab0b376d254bf21571f4aaf51cbe3251f4`），root pin 与配套产物已同步。
- Commit：`task-artifact-delivery T5: expose expiry cleanup and storage diagnostics`


## T8 轮次留存释放与本机副本回收

- 结果：task artifacts release 默认预览，apply 先保存轮次释放意图，再回收确认停止的输入/捕获副本和该轮各历史版本的 input/output 引用；外部及 recovery 引用保留。未交付候选需明确 --discard-pending，未知文件操作拒绝释放。释放/失败恢复参与已结束轮次扫描；同一释放重复调用继续原意图，不重放模型。受理、变化的失败和完成通过 artifactsRevision 通知，原完成版本与原生结论不变。释放期间阻止该任务新轮次/文件操作，完成后可 next；原轮次不再 retry/collect。
- 输入与展示：shared 下载副本在确认原生停止后自动回收，中心原件继续 pin；worktree 仍在准备时释放下载中间副本，其最终输入与工作区共同保留。download_retention 与中央留存状态、历史清单分别展示，release 不删除报告/Git/worktree，也不伪称解除引用后仍保证下载。输入回收错误恢复时保留同时存在的 incomplete 输出提示；全部捕获失败的操作也显式清理其受管临时目录。
- 自动验证：root 全量 126 pass / 2436 assertions；补齐释放失败的 wait 通知后，最终聚焦输入/输出测试 20 pass / 480 assertions，最终 typecheck 与 Linux x64 编译通过。覆盖所有历史版本引用、晚轮共享输入、未知/活跃拒绝、持久释放重启、丢失 unpin/副本释放响应、恢复 pin、缺失候选、原生续接与状态通知。日志 `.dev-smoke/artifact-t5b-*.log`。HAPI 保持 `c4c432ab0b376d254bf21571f4aaf51cbe3251f4`，复用 T5 的检查，不重复未变化的底座矩阵。
- 真实留存：`bun run test:task-retention .dev-smoke/task-outputs-u3MJua/evidence.json` 消费 T4b 的专用已结束任务，核对 Codex/Claude × shared/worktree 共 8 轮的实际输入目录、中心引用和候选回收。额外 collect 因 1 MiB 限额失败的 2 MiB 文件，普通 release 拒绝，显式放弃才删除实际 spool；全部历史轮次的本模块 pin 解除，外部 recovery pin 保留，原报告/清单/Git ref/worktree 不变。核对 HAPI session 和任务输入数不增加，删除释放后的中心对象释放配额，服务重启保留墓碑与释放状态。证据 `.dev-smoke/task-retention-LByxN9/evidence.json`，success=true、cleanupErrors=[]。该源 fixture 的附件现已按本次验证显式释放，不再假设其历史对象仍被保留。
- 原生续接：`bun run test:task-inputs dist/runweft --shared-only` 另开专用环境，实际通过 Codex/Claude 各两轮，共 4 轮。确认首轮输入目录已消失、中心输入仍受保护，重启服务后第二轮读取新随机输入并保持同一 native session；工程指令与 Runweft 子工具禁用保持。证据 `.dev-smoke/task-inputs-uLpknW/evidence.json`，success=true、cleanupErrors=[]，记录的 4 个 PID 均已退出。未改全局配置或权限模式，worktree 原生组合沿用 T4b。
- 最后修正的验证范围：整轮 capture 释放（含无成功候选）用上述真实输入任务追加一次缺失文件 collect，再通过编译 CLI 普通 release；真实 Runner receipt 变 released、spool 目录移除、清单/完成版本/原生 session 数保持，证据 `.dev-smoke/artifact-t5b-empty-capture.json`。之后提示恢复和 wait 通知的修正由最终聚焦测试覆盖并进入最终构建，没有重复运行未受影响的模型轮次。MCP 附件与四平台安装仍在 T6，不提前验收完整 Change。
- Commit：`task-artifact-delivery T5b: release round retention and reclaim stopped input copies`

## T6 MCP 组合、候选安装与整体验收

- 结果：MCP 新增 upload_artifact/read_artifact/download_artifact、retry_artifacts/collect_artifacts；spawn/next 接受原有 inputs/outputs schema。复用 CLI 的 ArtifactClient/TaskClient；源、目标及已有祖先按宿主 cwd 校验 realpath，只返回元数据。上传错误提示原 request ID，文件操作接受记录可从 list_agents 查回；文件传输沿空闲超时与宿主取消，不加服务端总时限。共同上传入口先拒绝非普通文件，并使用非阻塞打开避免 FIFO 在类型检查前卡住。
- 检查：最终根工程 `bun test ./test` 为 129 pass / 2608 assertions，typecheck、Linux x64 编译通过；最终文件相关聚焦组 22 pass / 564 assertions。涵盖两宿主身份、目录/symlink/FIFO、取消无残留、丢响应查回、文件操作的父归属和 native call 幂等。正向 MCP 重传验证固定候选不随源文件变化、补收才生成新内容，原生调用次数不增加；类型与完整目录发现无副作用。日志 `.dev-smoke/artifact-t6-final-*.log`。
- 真实 MCP：`bun scripts/smoke-artifact-mcp.ts dist/runweft` 的两宿主 × 两 runtime × local/同机 Hub 八组全部通过，共 16 个业务轮次。Hub 两个交叉 runtime 组合使用 worktree，其他为 shared。主宿主实际上传、查询、带附件派生、读取部分结果、核对缺失项没有重传候选、补收、下一轮续接和四次下载；每组复用同一 native session，旧对象字节不变，worktree 源仓库不变。真实 Codex/Claude 工具目录在启动和续接时均无 Runweft，其他 MCP 实际可调用，Claude 原生 Agent/Task 保留。证据 `.dev-smoke/artifact-mcp-DT6NQU/evidence.json`，success=true、8 cases、cleanupErrors=[]。
- 探针修正：首轮 `.dev-smoke/artifact-mcp-6mUJRn/evidence.json` 错误预期缺失文件 retry 会产生清单版本，实际返回 artifact_no_retry_candidate；宿主为满足错误版本要求多做一次 collect，严格次数断言失败。旧环境两轮已完成并完整清理，未重放旧任务；修正探针后在上述新专用环境验证。真实原生矩阵覆盖明确拒绝分支，固定候选的成功重传另由两宿主 MCP 的真实 SQLite/HTTP 测试及 T4b 实际 Runner/模型证据覆盖。
- 构建与安装：`bun run build:hapi --all`、`bun run package --all --reuse-hapi` 通过，五个候选包包含 macOS/Linux arm64/x64 二进制、固定 HAPI c4c432ab0b376d254bf21571f4aaf51cbe3251f4 的源码和许可。HAPI 无源码变化，不重复其 T5 跨包检查；既有 CLI 环境限制仍以 T5 记录为准。
- 实际 Linux x64 npm 安装：`.dev-smoke/install-j9xFCC/evidence.json` success=true，15 个 MCP 工具目录和 task/artifact 命令在无 Bun/源码 PATH 下可用；local、Hub 客户端、无 Runner Hub、SSE/WebSocket、信号、卸载留存由其 `services/service-tSd5GP/evidence.json` 验证。安装后 CLI 重启上述真实夹具服务，核对所有 16 轮的原生身份、完成 revision、报告和成果 hash；`.dev-smoke/artifact-package-o91pXd/evidence.json` success=true、cleanupErrors=[]。其他三个平台本次是编译/打包证据，未冒称实际执行；未公开发布。
- 边界：专用原生配置继承现有认证和权限，测试只批准夹具内已审阅文件操作。全矩阵最初构建先于最后的错误提示文字和 FIFO 拒绝修正，正常普通文件路径未变；最终检查、候选包及安装后的下载验证包含最终代码。真实跨机网络/仓库回收仍属后续 Change。完整 R1–R8 映射见 [验收](acceptance.md)。
- Commit：`task-artifact-delivery T6: expose artifact MCP workflows and verify candidate installation`
