# 远端代码成果回收

> 状态：待验收
> 规模：大型
> 更新：2026-09-30
> 确认依据：代码成果必须可被调用方取回；远端路径或不可访问 SHA 不算交付。2026-09-29 用户确认轮次结束保留 worktree、独立 worktree 自动 checkpoint 及默认 bundle 交付；具体清理期限与配额在正式方案中落实。

## Review 导读

将远端 subagent 的代码成果可靠带回主仓库，按委派和轮次追溯。取回与接纳改动分开；不把“agent 结束”或“报告写了成功”当作代码已经交付。

方案讨论见 [Design](design.md)，Git 原语验证见 [Research](research.md)。本 Change 消费公共 Git 能力已经固定的成果，不重做自动提交、worktree 生命周期、附件存储、原生终态或委派调度。

## Change 依赖

| 关系 | Change | 依赖内容与满足条件 |
| --- | --- | --- |
| 前置 | [远端工作区准备](../../archive/2026-09-30-remote-workspace-preparation/requirement.md) | 环境归属、确定基线与可恢复 Git 对象可用 |
| 前置 | [本地工作区执行](../../archive/2026-09-29-local-workspace-execution/requirement.md) | 公共 Git 封存和成果引用可用，本 Change 不再实现第二份提交或回收规则 |
| 前置 | [委派生命周期](../../archive/2026-09-29-delegation-lifecycle/requirement.md) | round/HAPI 关联、原生结束事实及下一轮写入调度；未知状态不能触发封存 |
| 前置 | [任务附件](../../archive/2026-09-29-task-artifact-delivery/requirement.md) | 持久对象上传、校验、访问控制和引用保留 |

C9 已验收 `RemoteBaselines` 返回的 `{snapshotId, origin, targetSource}`、consumer 留存及 HAPI repository export/import。业务任务引用该基线后创建自己的 environment，继续 TaskFiles、TaskWorkspaces 和既有轮次协调；不接管诊断工作树。前置实现与证据见[准备验收](../../archive/2026-09-30-remote-workspace-preparation/acceptance.md)。

## 独立验收与交付边界

依赖方分别验收契约后，本 Change 验收从主宿主派生、跨机执行到主仓库实际取回代码的完整远端链路，无需看板或最终发行整合。它提供成果传输、发布、保留依赖和取回操作；Git 固定成果由公共工作区能力提供。

失败重试只发生在交付部分，不回头重跑 agent 或重复生成 checkpoint。纯报告委派无需等待本 Change；自动 merge/cherry-pick 和 PR 发布不属于本次结果。

本 Change 同时接通正式远端委派：使用已有 Agent/runtime 绑定，远端只接受 worktree 和明确 base，自动调用已验收基线服务，不要求先执行诊断 CLI。其他身份、原生执行、输入输出附件与轮次语义保持既有约定。实施细节按用户持续授权自主落实，并在 Plan 完成后进行一次 iclaude 评审。

## 行为变化

### ADDED

#### `remote-results/snapshot`：可追溯代码成果

引用公共 Git 能力提供的初始 base、本轮开始 HEAD、成果 HEAD 和封存证据，关联原生执行结论。没有有效封存证据时不发布完整代码成果；失败或中断后的代码可以作为部分成果交付，但不能改写执行结论。无改动不制造提交，由共同封存规则保证。

#### `remote-results/delivery`：可验证交付

只有所需 Git 对象与必需附件可被调用方读取且校验通过，才声明完整交付。上传失败只重试交付，不重新运行 agent。LFS 和子模块有独立可取回要求，不能靠主仓库 bundle 假定完整。

默认通过中心 Git bundle 传输固定成果，不要求 push 或 PR。输入基线与输出成果的必需对象共同保留；主 agent 取得对象后负责合入、冲突处理和按需发布。

#### `remote-results/fetch`：主仓库取回

仅导入专用成果引用、Git 对象及必要 LFS/子模块对象，并提供 diff 入口，不修改主分支、工作文件、暂存区、FETCH_HEAD 或已有 Git 配置。重复取回相同结果无副作用；同名不同 SHA 拒绝覆盖。目标须为发起仓库的同一 Git common directory，可从其 linked worktree 操作；不按 remote URL 把另一个 clone 当成主仓库。后续接纳、冲突处理和发布由主 agent 完成，不新增合并工作台或冲突解决器。

#### `remote-results/retention`：保留可恢复现场

轮次结束关闭子执行进程，保留 worktree 与 session 记录供后续委派续接。代码取回或合入本身不触发 worktree 删除。未知执行、未封存改动或待上传成果存在时不自动清理；成果保留与环境回收分别判断。已发布成果应能在执行机丢失后依靠保留基线取回。

中心成果默认以恢复引用保留，沿既有文件配额和清理工具；只有操作者 CLI 显式释放才解除本轮引用。释放先预览，列出失去中心恢复能力的轮次及未交付候选，后者还需明确放弃；活跃/未知执行和未决文件动作不能被跳过。结果元数据与报告保留，释放后不得继续宣称可取回。原始输入基线与其他轮次、其他任务所需对象仍受保护。

### MODIFIED

#### `delegation/interface`：正式远端执行与代码结果入口

当前 CLI/MCP 拒绝跨机任务。目标允许已注册远端 runtime 的 worktree 委派，必须明确已提交 base；本机默认行为不变。CLI 通过 `task result show/fetch/retry/release` 管理已有任务轮次，不引入另一个必填 resultId；MCP 复用 `read_agent` 展示结果，并提供取回与重传工具，清理仍由操作者 CLI 显式执行。

报告中的原生结论、Git 封存、中心代码交付、附件交付分别可见；上传失败不把原生成功改成失败。取回和重传使用固定轮次及请求身份，丢回执可查询，成功发布/补交使用现有 revision/wait 更新机制，不新增后台注入或主宿主退出恢复要求。

#### `local-workspace/finish`：已回收成果的目标缓存释放

现有普通 worktree 移除保留成果 refs。远端工作区显式移除时，只有成果已持久交付或操作者已显式放弃对应恢复数据，才允许释放该环境在目标缓存中的固定成果 refs；同 cache 的其他环境、未知 refs 或未回收代码继续保护。HAPI 负责核对归属和精确 SHA，Runweft 决定哪些轮次已经交付或释放；本机默认保留 refs 的行为不变。

## 验收标准

- [x] 文本、二进制、删除、新增和无改动轮次都形成准确成果；不强制空提交或 PR。
- [x] 原生结束后仍有受控写入、Git 冲突、hook/签名或索引锁失败时保留现场，不假报封存成功。
- [x] 执行成功但上传失败可区分；确认丢失能查询原成果，不生成不同提交冒充重试。
- [x] 取回验证 Git 基线、对象和成果引用；主工作区有脏文件时也不被改动。
- [x] 没有 Git remote、输入及输出提交均未 push 时，主仓库仍可通过 bundle 取回可合入成果。
- [x] 源分支删除且执行机丢失后，已发布成果仍可依靠中心保留的基线验证并取回。
- [x] 清理不会删除未知执行、未封存代码或仍被结果依赖的唯一对象。
- [x] 两种宿主与两种 runtime 通过同一 MCP/CLI 远端 worktree 流程派生、等待、取回和续接；准备/结果能力不满足时拒绝，不降级 shared 或报告交付。
- [x] 新旧 LFS 实体与未改变的递归子模块对象可恢复；原有公共封存禁止脏模块或 gitlink 变化的规则继续明确报错，不能假报完整成果。
- [x] 下一轮不改写上一轮候选；无变化轮次复用可用传输对象，不创建空提交。重传/取回丢响应、重启和配额失败不重跑模型或封存。
- [x] 成果释放、worktree 移除与中心文件清理分别可观察；其他结果的基线/LFS pin 保留，明确失效不展示可取回。
- [x] 现有本地 shared/worktree、诊断准备及文件流程保持可用；更新四平台候选并实际安装验证。真实跨物理机器按用户授权单列未实测，不替代产品实现范围。

## 已确认的交付策略

2026-09-29 用户确认默认中心 Git bundle 交付，Git push/PR 作为显式发布。独立 worktree 遗留改动的自动 checkpoint 统一遵循[公共 Git 工作区](../../archive/2026-09-29-local-workspace-execution/requirement.md#已确认的成果策略)，不在本 Change 制定另一份策略。无 push 合码路径见 [Design](design.md#4-主工作区取回)。

## 协作资源

- [Git bundle 官方文档](https://git-scm.com/docs/git-bundle)（读取 2026-09-28）：提供引用/对象传输和增量前置校验；本地实验验证范围与限制见 Research。
- [Git fetch 官方文档](https://git-scm.com/docs/git-fetch)与 [bundle 文档](https://git-scm.com/docs/git-bundle)（读取 2026-09-29）：主仓库可从 bundle 导入成果对象和引用，再执行常规合入；不要求先 push 到 Git 托管平台。
- Multica [任务收尾](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/daemon.go#L8240)、[worktree 收尾](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/execenv/local_worktree.go#L509)与 [GC](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/gc.go#L405)（读取 2026-09-29）：本地 worktree 自动提交后删除目录，托管工作区保留复用并延后回收；详细边界见 [Research](research.md#multica-回收边界)，不自动转化为本项目决策。
