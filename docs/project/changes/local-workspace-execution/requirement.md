# 独立 Git 工作区与本地 worktree 协作

> 状态：进行中
> 规模：大型
> 更新：2026-09-29
> 确认依据：本地目录模式由主 agent 调度；独立 worktree 与远端采用相同准备规则；每轮保留现场，冲突与合入交给主 agent。2026-09-29 用户确认仅在 subagent 独立 worktree 内自动 checkpoint；公共 Git 能力先在本地交付，远端再复用。
> 细节按用户授权逐 Change 自主收敛；正式 Plan 经当前工作区 iclaude 一次评审后执行。

## Review 导读

在已有本地共享协作上增加独立 worktree，并成为本地/远端共用的 Git 生命周期提供方。负责确定基线、创建与识别 worktree、启动就绪、固定成果、保留和清理条件；不负责跨机传输或中心文件服务。共享目录行为由[委派 Change](../../archive/2026-09-29-delegation-lifecycle/requirement.md)交付，不在此重复实现。

## Change 依赖

| 关系 | Change | 依赖内容与满足条件 |
| --- | --- | --- |
| 前置 | [HAPI 执行契约](../../archive/2026-09-29-hapi-subagent-foundation/requirement.md) | 在指定 cwd 启动、结束和续接执行 |
| 前置 | [委派生命周期](../../archive/2026-09-29-delegation-lifecycle/requirement.md) | CLI/MCP 协作、准备/收尾条件与串行轮次可消费 Git 证据 |
| 下游 | [远端准备](../remote-workspace-preparation/requirement.md)、[远端结果](../remote-result-delivery/requirement.md) | 复用仓库/环境身份、准备与固定成果，不重新实现一套 Git 生命周期 |

## 独立验收与交付边界

本机仓库和真实本地 agent 即可完成验收，不依赖远端 Runner、网络传输或附件中心。本地 worktree 共用主仓库 Git 对象；公共准备逻辑也可针对执行机缓存仓库调用，但缓存对象的网络来源由远端 Change 负责。

Git 动作沿 HAPI 现有代码增补。该 Change 不是新的执行框架或独立 worktree 服务；独立模式所需输入接收已解析的本地文件路径，不直接依赖附件上传接口。附件在任务中的组合接入由附件 Change 完成。

当前 HAPI worktree 创建与启动绑定，缺少固定基线、准备回执和程序化封存入口，调查见 [Research](research.md)。补齐通用 Runner/Git 能力，不修改 Codex/Claude 原生 runtime 适配。

## 行为变化

### ADDED

#### `local-workspace/mode`：选择独立工作区

主 agent 可以在已有共享模式之外选择独立 worktree。独立模式要求可解析的已提交 Git 基线，固定本次 SHA；主工作区未提交/未跟踪内容不自动迁入。不同 subagent 分离改动，同一 subagent 后续轮次复用原 worktree 和依赖，不自动吸收主分支的新提交。

CLI `--workspace-mode worktree` 与 MCP `workspace_mode=worktree` 选择独立模式，`--base` / `base_ref` 默认 HEAD，接受时冻结为准确 SHA 并在结果展示。默认 shared 不变；本 Change 的两种模式都只能选择发起机器上的 runtime。

#### `git-workspace/lifecycle`：公共 Git 准备与成果固定

唯一维护仓库、环境与准备身份，核对 cwd、基线、分支和目录归属后创建或复用 worktree；失败不覆盖未知目录。启动入口使用准备证据，不能在核对后又创建默认 HEAD 的第二份工作区。

执行已停止写入后固定本轮 base、开始 HEAD、成果 HEAD 与保留引用；仅在 subagent 独立 worktree 内将遗留未提交改动补成 checkpoint commit，本地与远端共用。保留 agent 已有提交，无改动不产生空提交；无法封存时保留现场并阻止会混入成果的新一轮写入。仅知道 SHA 不代表远端已交付，其对象传输由远端结果负责。

#### `local-workspace/readiness`：启动位置与工程配置

独立模式固定所选 Git 基线，在准备完成的对应工作目录启动。沿 HAPI 原有能力实现；已解析输入和上下文按需就位，项目依赖由 agent 安装，skill/MCP/工程指令由原生客户端在该目录加载。

同机独立 worktree 可共用本机 Git 对象，不为复用流程强制上传完整仓库。对未进入基线、ignored 的工程 skill，不宣称远端或新 worktree 已自动继承；遵循原生发现能力并明确缺失。

#### `local-workspace/finish`：结束执行与主 agent 接纳

每轮任务结束关闭该 subagent 执行进程，保留可续接 session 与工作区。独立工作树的代码成果交回主 agent，同仓库可直接从成果引用合入；合并与冲突由主 agent 处理。取回或合入不自动删除 worktree。

公共回收逻辑只接受已确认归属、无活跃或未知执行、无未封存改动且必需成果已保留的环境；不触碰共享主目录。远端再补充上传和对象依赖条件，不能绕过公共检查。具体清理期限与动作仍在正式方案中落实。

默认无限期保留，无自动定时删除。CLI 显式删除环境必须检查全部轮次、成果引用与现场；有 ignored 文件时默认拒绝，明确 `--discard-ignored` 才允许删除这些文件。清理不删除报告、原生历史或固定成果引用；后续消息明确拒绝已删除环境。

封存失败显示原因和修复路径；主 agent/操作者修复后可通过 CLI/MCP 显式重试本轮收尾，不重新运行 agent 或无限重跑 Git hook。保留纯报告和部分失败成果，原生执行结论不被 Git 成败覆盖。

LFS 与子模块在准备时实际初始化和验证，缺工具/对象/权限则停止。当前自动封存不替子模块创建提交或传输新 gitlink 所需的独立对象；子模块内部脏文件或 gitlink 相对本轮起点改变时明确阻止封存、保留现场，由主 agent 处理。不能把只保存父仓库 SHA 称为完整子模块成果。

### MODIFIED

#### `delegation/interface` / `delegation/results` / `delegation/rounds`

派生新增固定基线和独立模式；查询展示准备、执行停止、Git 固定成果及保留/清理状态。工作区收尾未成功时后轮保持阻塞；新增显式重试收尾能力，沿既有父权限、去重与取消语义，不重建委派状态库。

#### `execution/lifecycle` / `execution/recovery`

通过 HAPI 启动/续接已准备路径时携带准备引用，由实际 Runner 启动点复核。共享模式及不使用准备引用的既有 HAPI 会话保持原行为。

## 验收标准

- [ ] 独立模式在正确 Git 基线、已准备的 worktree 启动，准备失败没有 agent 进程。
- [ ] 两个独立本地任务不覆盖彼此目录，续接复用原环境；主仓库 HEAD、暂存区和共享文件不被程序化收尾修改。
- [ ] 遗留未提交改动自动形成 checkpoint，保留 agent 已有提交；共享主目录不自动提交。
- [ ] 两种 runtime 通过真实 CLI/MCP 独立模式协作，不依赖远端或附件中心完成验收。
- [ ] Git 冲突、辅助文件归属不明、提交 hook/签名或索引锁失败时保留现场，不假报成果已封存；无改动不制造空提交。
- [ ] 同仓库成果引用可由主 agent 合入；执行、代码固定及环境回收条件分开表达。
- [ ] 使用原生全局与工程配置；不创建空白配置 home，不集中同步 skill/MCP。
- [ ] 结束子执行不停止主 agent、共享 HAPI 服务或其他任务；后续委派按原 session 优先续接。
- [ ] 默认保留环境；显式删除拒绝活跃/未知停止、未封存和脏文件，ignored 内容需明确丢弃；删除后成果引用仍可读取，后续委派不会偷偷重建。
- [ ] LFS 实体与子模块基线实际可读；能力不足无 agent 启动，子模块变更不被不完整封存或清理吞掉。

## 已确认的成果策略

2026-09-29 用户确认独立 worktree 自动 checkpoint，失败保留现场；共享主目录不自动提交。该规则同时约束本地独立与远端，提交身份、hook 与签名的实现细节在正式方案中落实。
