# 远端代码回收实施计划

> 来源：[Requirement](requirement.md)、[Technical](technical.md)、[结果契约](result-contract.md)
> 状态：已完成
> 执行模式：主 agent 逐任务本地提交
> 评审：当前工作区 iclaude 唯一一次评审已完成，主 agent 已复核并简化留存及补齐流程；见 [Execution](execution.md)。用户已持续授权自主落实、执行与本地验收，不重复申请门禁。

## 交付目标与切片

使远端 Agent 在既有固定 worktree 中完成任务后，主 agent 能通过同一 CLI/MCP 取得可合入的代码。先验证机器成果导出与主仓库取回，再做中心交付，最后解除远端派生限制；中间版本不能暴露只有报告而无代码回收的业务路径。每项独立验证并提交，HAPI 的通用增补在其独立仓库提交、根项目同步 pin；不 push/PR/publish。

### T1 HAPI 已封存成果的验证与导出

- 状态：已完成
- 依赖：C7/C9 公共 Git、仓库与文件能力已验收。
- 交付：repositoryResults capability 与 export-result/inspect/release；读取受管环境的确定成果，从 checkout 根导出完整 Git/模块/LFS，回执绑定封存 facts。提取并复用现有独立快照验证器，不修改原生 adapter 或 checkpoint。
- 验收：普通/无改动/失败执行的部分成果、新增二进制 LFS、源路径与 URL 不可用、原任务子目录删除、两轮固定成果；缺 Git/LFS/模块或身份/ref/祖先关系不符明确失败。候选固定前保护后续写入，丢回执/重启沿原 ID，绝不创建第二个提交。
- 验证：真实 Git 聚焦与 HAPI types/适当跨包检查；配套编译 CLI+Hub/Runner 的无模型封存→导出→现有文件发布/下载，独立导入/fsck 验证；保存真实磁盘证据。

### T2 HAPI 向原主仓库取回对象

- 状态：已完成
- 依赖：T1。
- 交付：fetch-result 持久机器操作；独立验证后追加根/递归模块 Git 对象和 LFS，固定专用 refs，明确查询/重试及中间副本释放。支持 existing/linked worktree 的原仓库身份，不改变已有配置或执行工程 hook。
- 验收：parent staged/unstaged/untracked/HEAD/FETCH_HEAD/config 保持逐字节不变；相同 ref 重取成功、不同 SHA 拒绝、目标错误拒绝。删除源分支、隐藏执行机后取回可实际合入；无 remote、sha1/sha256、基线和成果的新旧 LFS（先删除原主机旧实体）、自定义 storage、未初始化/嵌套/重名模块和已有模块映射验证。配置了 reference-transaction hook、递归 fetch、commitGraph/maintenance 的目标也不执行 hook/联网/改已有配置；未知/失败保留已追加对象并如实报告，不清理用户数据。
- 验证：真实 Git/文件故障检查、操作中断和丢回执；实际 Hub 两 Runner+文件通道完成 T1 导出→执行端停机→主仓库取回及显式合入；类型/聚焦/配套构建。

### T3 中心代码清单、交付与取回入口

- 状态：已完成
- 依赖：T2。
- 交付：state v6、不可变代码清单、发布/取回/retry 记录和 code revision；与 TaskOutputs 同形的 TaskResults.advance 入口、共享仓库文件传输 helper、完整快照/HEAD/模块 bundle/LFS 复用与直接 recovery pin；不改变原 consumer 表。CLI task result show/fetch/retry 和 MCP fetch_result/retry_result；沿现有身份/任务读取，尚不开放远端 spawn。
- 验收：中心无 Runner/Git；字节成功但封存/语义不匹配不能 available；分批/配额/上传丢响应/重启/目标离线/重传均不重跑封存或模型。取回冻结轮次、校验原仓库，不静默读旧结果；本机已有成果直接展示原引用。原生结论、代码与附件完整性分别表达。
- 验证：真实 HAPI prepare → finalize 的无模型环境驱动 TaskResults，与 SQLite/HTTP/API 组合，不用手写封存事实代替；schema v5→v6 保留全部旧表/行；提取公共传输后立即运行 C9 基线/诊断聚焦及实际脚本；root tests/types、CLI/MCP 与执行机离线取回证据。

### T4 远端 worktree 委派接入

- 状态：已完成
- 依赖：T3 已实际证明交付/取回闭环。
- 交付：客户端/中心允许远端 worktree+明确 base；task origin/consumer/targetSource 持久关联，同一 baselines 实例和恢复扫描；TaskCoordinator 在 prepare 前消费基线，在已有 finalize 后调用 TaskResults，其他原生/轮次流程复用。
- 验收：不手工 prepare，首次失败无模型、dirty 排除、来源分支移动不改基线；两种 runtime 两轮续接同 worktree/native session，新输入和输出正常；固定候选后下一轮不破坏前轮重传；代码交付错误不回写已 sealed facts，捕获失败的 finishing 轮次能显式 retry；未知 start/stop 不重复执行；远端 shared/缺 base 拒绝，本机默认 HEAD 与 request ID 兼容。远端删除在完整清理规则接入前明确拒绝。
- 验证：聚焦协调/恢复/取消/consumer 插入后崩溃、共享服务关闭顺序及 remote hook/签名/index lock 收尾失败检查；实际 CLI 的两 runtime 各两轮、取回并合入验证；根全量与配套构建。

### T5 成果与目标缓存的显式释放

- 状态：已完成
- 依赖：T4。
- 交付：CLI result release 预览/apply/discard-pending、逐轮直接恢复引用与任务基线释放；公共 remove 的精确成果 ref 释放事实与 cache release 对接。paths/doctor/使用说明给出持久目录及正确清理顺序，不增加临时存储根。
- 验收：worktree 保留默认、取回不自动删除；已发布成果在执行机/目标 cache 消失后仍可取回。活跃/未知/未封存或仍在捕获时禁止清理；已停止且捕获确定失败可显式放弃、结束该轮并放行已排队下一轮，仍须正常 prepare；明确放弃不影响其他任务、轮次、输入基线或 LFS pin。跨快照/共享 import 消费者和外部 refs 保护、部分释放重启继续、原生及模型运行计数不增加。
- 验证：真实磁盘/RPC/SQLite 的多任务同 cache 与多轮清理；无模型 fixture 先覆盖故障，实际已完成原生 fixture 验证公开 CLI 保留/释放；类型/聚焦/受影响全量与重建。

### T6 完整原生协作与候选安装

- 状态：已完成
- 依赖：T5。
- 交付：两宿主 × 两 runtime、各至少两轮的真实 MCP 远端准备→执行→代码/附件回收→取回→续接；CLI 同能力与文档、四平台 private 包和实际本机 npm 候选安装。
- 验收：专用 Hub 无 Runner、不同 source/target Runner，原仓库无 remote，包含未改变的递归子模块；真实 cwd/工程指令/skills/二进制 LFS、工具过滤和其他 MCP、进程退出、重传仅传文件、源分支删除/执行机离线后主仓库脏状态不变且可实际合入。增加本机 shared/worktree 和 C9 诊断的适当回归；所有操作身份、清单和清理结果留证。
- 验证：root/HAPI 适当最终全量/types、协议 fixtures、四平台配套构建、npm 实装后服务/查询/重启/下载/取回；其他 OS 与真实跨物理机器未实测单列。按 Requirement 逐项验收、Specs 同步和归档另一个本地提交。

## 不变约束

不新增 runtime、账号、集中 skill/MCP 管理、宿主关闭恢复、自动合并或额外权限隔离。HAPI 的标准子模块封存限制继续明确报错，不用不完整 bundle 隐藏缺陷。每项以真实回执和副作用证明，不以 mock 或单机多进程冒称物理跨机验证；评审建议由主 agent 复核后采纳，不为极端假设建立第二套框架。
