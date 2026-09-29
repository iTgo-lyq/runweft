# 任务附件实施计划

> 来源：[Requirement](requirement.md)、[Technical](technical.md)、[契约](artifact-contract.md)
> 状态：执行中
> 执行模式：逐任务本地提交
> 评审：当前工作区 iclaude 一次已完成，主 agent 已独立复核采纳；见 [Execution](execution.md)，不重复评审。

## 交付目标

单一 CLI/MCP 支持文件上传、启动前输入、持久成果及补交；local/Hub 共用 HAPI，已交付文件不依赖执行机会话在线。大小与留存清晰可配置，默认不会清掉仍被任务使用的文件。

## 关键边界

- 通用字节存储/机器传输只放 HAPI，Runweft 不保存第二份中心字节。
- shared 的 preparedFiles 沿原 spawn/resume 契约，worktree 复用已有输入门禁，不造另一套 runtime。流式接口必须穿过实际反向代理和 Bun body ceiling。
- 输出失败只重试捕获候选，原生结果和文件交付状态分开；补交不改旧对象和清单。
- 第一个任务就交付可使用的文件 CLI，第三个任务接通真实模型，不将所有可行性风险推迟到最终验收。
- 输出阶段按已验证的职责边界分为 T4 机器交付和 T4b 业务清单，分别提交；总范围与一次 iclaude 评审的结论不变。
- 专用环境继承已有模型认证，不改用户全局配置；跨机实测不在本 Change 冒称完成。

## 任务

### T1 无会话的中心文件与 CLI

- 状态：已完成
- 依赖：已验收统一 CLI/HAPI 契约。
- 交付：HAPI SQLite 对象/引用、流式 reserve/PUT/GET/inspect/delete、配额和 crash reconciliation；Runweft artifact upload/show/list/download/remove/refs、清晰 request ID 与取消。服务 limits 与 server.artifacts 配置同步到实际 HAPI，统一数据根，能力声明。
- 验收：无活跃会话完成 local/同机 Hub 上传/下载，>68 MiB 文件穿过编译服务和代理；长度/hash/配额错误不可读，断流后同 ID 重试，已发布不可覆盖；namespace、pin/delete 竞争、中文/空格文件名及目标覆盖行为明确；限速流没有固定总时长截断，413/非 JSON 代理错误提供下一步。
- 验证：真实 SQLite/HTTP/文件流聚焦测试、CLI smoke、编译产物；HAPI 跨包 typecheck/test 和相关契约检查，root typecheck/test。HAPI 独立提交，root 更新 revision。

### T2 机器输入准备与原生读取门禁

- 状态：已完成
- 依赖：T1。
- 交付：既有 Runner/API 的 materialize/inspect/release、持久回执与统一 inputs；shared 的 preparedFiles 贯穿启动/续接 schema、指纹、metadata、Hub/RPC、Runner 与 Runweft ExecutionClient，worktree 复用 prepare.inputs。共享安全 Unicode 输入名 schema，当前输入目录必要时走既有 --add-dir 通道。
- 验收：无需 agent 的真实 Runner 可准备输入，耗时操作快速受理、断网/重启可查原回执。两 runtime 各有真实模型探针读取本轮输入，确认原生默认权限和项目配置；worktree 的中文/空格名称通过。准备失效的 spawn/resume 在 childStarted=false 阶段拒绝，纯文字和无关会话不受影响。
- 验证：实际机器 HTTP/RPC smoke、流式大文件、取消与回执故障测试、两 runtime 实际文件读取；HAPI 必需跨包检查/编译，root 参数回归。原生 adapters 不改造。

### T3 CLI 任务输入与真实原生续接

- 状态：已完成
- 依赖：T2。
- 交付：spawn/next input 参数、输入冻结/pin/接受意图对账/业务归属，shared/worktree preparing 接入机器文件，实际输入映射进入 prompt；输入错误不启动。
- 验收：真实 Codex/Claude 从准备文件读取内容后报告，第二轮新增附件且续接相同 native session；共享 cwd 不被植入配置，worktree 工程指令与输入同时可用；已接受 input 防删除，输入损坏/缺失/断线没有重复启动。输出参数在 T4b 连同成果功能一起开放，不公开只接受但不交付的参数。
- 验证：中心 SQLite/请求指纹/引用测试、两 runtime 编译 CLI 真实 smoke、目录/hash/PID 证据，纯文字 shared/worktree 回归。

### T4 HAPI 固定输出候选与机器交付

- 状态：已完成
- 依赖：T3。
- 交付：Runner capture/deliver 与持久回执、逐项错误、固定上传身份与中心 pin、选择性 spool 释放；单独声明输出能力，复用现有机器接口和流式对象 API。
- 验收：工作区修改或删除后仍只上传固定候选；缺失项和限额失败不影响成功项；发布丢响应与 Runner 重启保留原身份；成功候选可单独释放，活跃传输禁止释放。Runner 离线后中心下载正常。
- 验证：真实文件/HTTP 故障测试、HAPI 跨包检查、配套编译及真实 Hub/Runner 的 72 MiB 捕获/部分交付/重启/离线下载；不以模型执行替代机器文件验证。

### T4b 输出清单、部分交付与文件补交

- 状态：已完成
- 依赖：T4。
- 交付：CLI 输出声明参数、原生关闭/Git 封存后调用机器文件接口、不可变版本清单和原生/git/artifact 分栏；task artifacts retry/collect，只传固定候选；read/wait/artifactsRevision 暴露补交，已完成轮次上的文件操作参与重启扫描；清单确认后自动回收成功 spool。
- 验收：两 runtime 实际生成多个文件并可下载；缺失文件形成 incomplete，另一个成功项仍可下载；上传故障/配额/丢响应修复只推进文件交付，不重放模型或 Git；补交新版本、旧版本稳定，终态 status 不因文件交付错误被改写，下一轮改同名 cwd 文件不污染旧候选。关闭 Runner 后下载已发布成果仍成功。
- 验证：业务中心故障/并发/重启测试、真实 CLI 模型执行与 Hub 文件校验，确认调用次数/PID/任务输入 ID 没增加；worktree 清理不丢未交付 spool。复用 T4 机器文件证据，不重复检查未变化的 HAPI 实现。

### T5 留存清理、用量与部署说明

- 状态：待开始
- 依赖：T4b。
- 交付：过期 prune、轮次 release 默认预览/apply、明确放弃失败候选；已登记未完成接受意图自动对账，未知 pin 保守保留；paths/doctor 用量/位置/恢复提示，配置/备份/代理/清理说明。
- 验收：active/result/recovery pin 保护、配额释放、丢响应后的 release 重试、墓碑及可变留存与不可变清单分别展示；成功 spool/materialize 中间副本自动回收，失败候选保留。Hub 是字节权威，客户端设置不覆盖服务端 limits。默认权限下读取自己附上的输入无额外配置负担。
- 验证：实际清理/并发/服务重启、CLI 与配置测试；可用时同机真实反向代理 smoke，无代理时如实记录部署配置未实测，不伪称验证。

### T6 MCP 组合、候选安装与整体验收

- 状态：待开始
- 依赖：T5。
- 交付：两原生宿主使用上传/元数据/下载工具和 task inputs/outputs、补交/重试，与 CLI 共用业务实现；四平台候选包、安装说明与完整需求验收映射。
- 验收：Codex/Claude 宿主 × Codex/Claude runtime 在 local/同机 Hub 的真实输入、输出、续接与结果读取；shared 为主并覆盖 worktree 组合，子执行无 Runweft MCP，其他原生配置/工具保留。MCP 文件路径限制和取消/超时不重放任务；安装包可运行，无源码/Bun PATH 依赖。
- 验证：最终配套编译、专用原生配置/真实 MCP/模型/hash/PID 证据，类型检查/相关测试及候选安装；不以仅 tools/list 或模拟替代真实调用。对代码未变部分复用已有证据，昂贵矩阵只在上述功能齐备后运行；跨机限制单独记载。

## 关闭

T1–T6（含 T4b）每项独立本地 Commit，HAPI 变更独立提交并由 root pin。按用户自主验收授权将 R1–R8 映射到真实证据后同步 artifacts 输入/交付/留存 Specs 与相关委派/部署 Specs，另作归档 Commit。公开发布留给完整集成 Change，不提前宣称成品交付。
