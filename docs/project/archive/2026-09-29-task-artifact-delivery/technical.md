# 任务附件技术方案

> 来源：[Requirement](requirement.md)
> 更新：2026-09-29
> 确认方式：沿用户对自主细化和实施的持续授权；Plan 实施前仍需一次 iclaude 评审。

## 方案与职责

HAPI 维护 namespace 文件对象、流式 HTTP、引用和机器文件操作；Runweft 维护业务归属、轮次输入、输出清单及 CLI/MCP。现有 session upload/scratchlist 保持原用途，不伪装成任务附件。证据和具体缺口见 [Research](research.md)，字段及状态见 [文件契约](artifact-contract.md)。

文件字节唯一权威在中心 HAPI_HOME/artifacts，元数据进入既有 HAPI SQLite。Runweft 现有 state.sqlite 保存轮次关联和不可变清单；Runner 连接数据根保存输入、传输回执与未完成候选。没有新守护进程、凭据或对象服务。

## 用户路径

1. `runweft artifact upload ./brief.pdf` 返回 ID、hash 和字节数；`artifact list/show/download/remove/prune` 提供普通操作。传输进度与 request ID 写 stderr，JSON/stdout 保持可消费，取消不暗示删除已发布对象。
2. `task spawn reviewer --input <id> --output report.md --message ...`；重复参数支持多文件，`--input name=<id>` 可改逻辑名。默认使用对象文件名作为逻辑名，重复或无法安全落地时要求显式名称。next 可提供新一轮的附件，未提供时该轮没有新输入/输出约定；不自动覆盖旧文件。
3. `task show/wait` 同时返回原生结果、Git 结果和文件清单，展示下载/重试动作。`artifact download <id> --output ./report.md` 校验后原子写入，已有目标默认拒绝，显式 `--overwrite` 才替换。
4. `task artifacts retry <id> --round <id>` 重传该轮捕获候选；`task artifacts collect <id> --round <id> --path report.md` 显式补收遗漏文件。重试只用候选，不重新读取可能已变化的 cwd。补收需本任务所有轮次静止，记录新的 capture 时间。
5. `artifact refs <id>` 查看留存原因；`task artifacts release <id> --round <id> --apply` 默认预览本轮输入/输出留存，显式 apply 才释放已结束且无未处理传输的引用。省略 round 时预览该任务全部已结束轮次。报告清单内容不改，另显示当前留存状态；后续需要已释放输入时重新提供附件。普通清理不能释放基线恢复 pin，未来 Git 回收负责对应生命周期。

MCP 提供本机路径上传、对象元数据/下载，以及 task 的 input/output 和补交/重试入口；列表以 read_agent 中的清单为主，不把二进制放入模型上下文。MCP 上传源和下载目标限制在原生 cwd 内（包括 realpath 检查），CLI 的显式路径沿操作者权限；不将未知的原生沙箱规则解释成 MCP 任意本机读写授权。所有新增 Runweft 工具继续在受控子执行中禁用，子 agent 只需写声明的输出路径。

## 执行链路

### 输入

中心先保存附件接受意图，再核对 available 文件并建立稳定请求引用，随后写入既有任务接受事务；相同请求的附件列表进入指纹。已确认拒绝回收新增 pin，响应不明时保守保留。启动时在开放接受入口前对账本中心记载的未完成意图：已有接受记录则保留，否则释放对应 pin。未知来源引用不凭年龄删除。跨两个数据库不伪造原子事务，用户无需维护孤立请求引用。

轮次 preparing 调用 HAPI 机器文件 materialize，异步受理后按 operation ID 查询。Runner 通过 `/cli` 同 namespace HTTP 下载并核验，返回本机文件路径与准备引用，materialize 不绑定 cwd。shared 不更改源目录；worktree 继续调用公共 Git prepare 传入这些本地文件并使用它返回的最终输入映射，成功后释放中间下载副本。

共享目录的 spawn/resume 使用可选 preparedFiles，沿 shared schema、回执指纹、metadata、Hub/RPC 和 Runner；独立 worktree 只使用既有 preparedWorkspace，其 inputs 校验不再与 preparedFiles 重复。Runner 在启动前验证当前目录及相应准备凭据和摘要，再进入原有原生启动函数；新一轮 resume 显式传当前准备引用，没有输入则传 null 清除旧绑定；普通 HAPI 省略该字段仍继承。能力缺失时在派生前拒绝，未携带附件的原有启动不变。只改外围启动参数与门禁，不修改 Codex/Claude runtime 执行循环。

### 输出

原生可靠停止后先完成独立工作区既有 Git 封存，再收集声明的文件。Runner 用同一打开的 regular file 流式复制到受控 spool，计算摘要并检查采集期间大小/mtime，记录实际捕获时间。共享目录由主 agent 调度写入，本模块不承诺对其他写入者的文件系统快照隔离。

中心先持久保存交付操作身份；Runner 对每个捕获候选以固定上传 request ID 预约并 pin，再 PUT 字节。上传结果未知只查该对象或从相同候选重传，不能重新抓 cwd 的新内容。Hub 校验并发布对象后，Runweft 事务发布新清单版本，确认 pin 与清单都持久后释放已交付 spool。部分失败保留逐项错误、候选和原生结果，已可取回项不受影响。

传输进行/未知期间 round 保持 finishing，不启动下一轮；确定成功或部分失败才完成收尾。部分失败保留既有轮次 status，向 read/wait 暴露 artifacts attention 与 incomplete 清单，下一轮可显式排队并串行执行。后续传输重试独立于模型轮次推进，但只读固定候选；清单发布和留存变更分别保存本轮 artifactsRevision，wait 以 max(completedRevision, artifactsRevision) 通知；completedRevision 不变。已结束轮次上的文件操作也进入协调器 pending 扫描，保证重启可继续。缺失文件需 collect 显式补收，不伪称原候选重试。

## 配置、保留和数据兼容

服务端配置使用 `server.artifacts.maxFileMiB`、`server.artifacts.namespaceQuotaGiB`、`server.artifacts.unreferencedDays`、`server.artifacts.pendingHours`，默认分别 512/10/7/24。Runweft 向所管 HAPI 进程传对应环境值；Hub 客户端通过服务 limits 查询真实限制，不以自己的本机配置覆盖远端。Bun server 的 body ceiling 配套提高；Hono 对二进制 content 路由以外的 /api、/cli HTTP 请求保留 68 MiB 上限，原有更小业务限制和 Socket.IO 上限继续生效。网关禁用二进制传输的总请求时限；Hub/客户端以空闲超时及用户取消处理停滞，不用固定总时长截断持续传输。

清理默认 dry-run，`--apply` 才删除满足策略且无引用的对象；单对象显式 remove 不要求满 7 天，但同样不能删除有引用对象。输入缓存、spool 与工作区清理分别说明；未交付候选不得随 worktree remove 或服务重启消失。释放/清理与任务接受、收集、删除通过既有中心串行入口协调，HAPI pin/delete 通过本地 SQLite 事务互斥。

HAPI 新表随 schema version 升级，Runweft 新清单/关联表随 state schema 升级；已有任务的缺省附件为空，纯报告/shared/worktree 原行为不增加文件操作。不迁移 scratchlist，不移动用户原生配置。HAPI 子仓库独立提交，root 更新 pin；回退前备份两数据库与 artifacts/spool，不能只回退数据库文件或删除未传输文件。

## 授权与故障

JWT `/api` 与 CLI token `/cli` 各沿现有 namespace 规则，业务任务归属沿 TaskStore.require。文件 ID/hash 不替代认证，传输不接受任意下载 URL，Runner 仅访问配置的 Hub。对象文件名只作显示，内部键为 namespace hash 和随机 ID；本机输入名及输出相对路径校验拒绝逃逸。附件元数据不保存 token、全文 prompt 或源码副本，日志只写 ID/大小/状态。

错误保留具体 code、阶段和用户可执行提示。缺失/校验失败/配额/本地磁盘错误正常上报，不增加隐藏 fallback；断线不重跑模型。传输空闲 60 秒中止并保留可查询回执，可由用户取消；没有固定总传输时限。HAPI RPC 只受理/查询，不以持续占用连接保持任务。默认不做分片续传：中断后以同一对象 ID 从零重传，512 MiB 内可接受，后续 Git bundle 可以按部署配置提高上限。

## 就绪性与验证

调用/存储/身份/准备/续接入口已从当前源码核对；无必须询问用户的外部契约。T1–T4 已完成流式对象、CLI 任务输入和机器候选交付的真实 HTTP/Runner、原生读取验证，证据见 [Execution](execution.md)；T4b 已接通 Runweft 版本清单、重传和补收并通过两 runtime 的真实组合，T5 已提供中心过期清理与用量诊断，T5b 已完成轮次留存释放、失败候选放弃和共享输入副本回收。独立会话关闭、>68 MiB 文件、错误摘要/配额、断线重试、pin/delete 竞争、跨 namespace、路径逃逸、部分清单与旧版本稳定均须按阶段实际验证。

真实 Codex/Claude 在本地和同机 Hub 接入 CLI/MCP，确认输入可读、默认权限继承、输出可下载及子工具仍禁用。T2 先实测两 runtime 读取程序已准备的输入；Claude 如要求额外目录授权，Runner 仅将当前输入目录沿已有 --add-dir / claudeArgs 通道转交，不覆盖 permissionMode、不改 runtime 循环。其他任意目录仍沿原生审批，不扩大为 home。已核对 HAPI 参数过滤器保留 --add-dir，实际效果须用模型探针确认。实际跨机验收不在本 Change 冒称通过。

独立 worktree 未忽略的输出会随既有 git add -A 纳入成果；帮助和 prompt 明示。Git 封存需要处理时，文件交付等待 retry-finish，不凭文件存在跳过 Git 收尾。反向代理的 413/非 JSON 错误提供限制和部署提示，使用说明补请求体/缓冲/超时配置。
