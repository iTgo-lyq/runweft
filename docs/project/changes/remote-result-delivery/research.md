# 远端代码回收与工作区保留依据

> 调查日期：2026-09-28；Multica 收尾补充：2026-09-29
> 本文记录局部 Git 实验和上游源码调查，不表示应用、HAPI 或真实远端链路已验证。

## Git bundle 原语

[Git bundle 官方文档](https://git-scm.com/docs/git-bundle)确认可打包引用和对象，通过 clone/fetch 导入；增量包依赖接收方已有前置 commit，可用 verify 检查。bundle 不自动传输 Git 管理范围外的数据。

**本地实验已验证：** 使用 Git 临时仓库完成完整输入 bundle → 远端 bare 缓存 → 独立 worktree → 增量结果 bundle → 基线组合验证 → 父仓库专用引用导入。父仓库 HEAD、工作文件和暂存区未改变。实验使用专用提交身份，仅在临时仓库写入，没有改变用户 Git 配置。

临时证据位于 `.dev-smoke/remote-git-design-msmawks3/evidence.json`（不提交）。未运行真实 HAPI/agent、跨主机传输、LFS 或子模块，不构成应用链路认证。

## Multica 回收边界

[Multica 源码调查](../../archive/2026-09-30-remote-workspace-preparation/research.md#multica-的任务准备与成果交付)区分了程序回传运行终态、prompt 引导成果工具和本地 worktree 的程序化提交。后者不能被当成远端已推送或主工作区可取回的证据。

以下核对提交 `67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25`，只确认源码行为，未实际运行 Multica。工作区策略由资源模式决定，不能仅按执行机器在本地还是远端分类。

| 模式 | 本轮结束 | 后续复用与回收 |
| --- | --- | --- |
| 用户本地目录，原地执行 | 改动留在用户目录；daemon 清理本轮注入的说明片段和辅助文件，这条收尾路径不自动提交。 | 不删除用户目录；任务根目录中的日志保留，允许清理可再生缓存。 |
| 用户本地目录，独立 worktree | 先清理注入文件，再对剩余未提交改动自动提交，保留原仓库中的成果分支，最后移除临时 worktree。成功与失败退出都会尝试收尾。 | 后续轮次可从同一会话的成果分支创建新 worktree；复用分支不等于保留原目录和依赖。新建且没有成果的分支会移除，已有续接分支不会因本轮无改动被删除。 |
| 常规托管任务工作区 | 保留 workdir；数据库记录路径，下次通过 `PriorWorkDir` 供同一 agent/issue 的任务复用。所查路径没有统一执行本地 worktree 的自动提交收尾。 | GitHub 代码交付仍由 agent 按任务规则执行提交、推送和 PR；工作区由后台 GC 按 issue/chat 生命周期与保留时限回收。 |

依据：[daemon 收尾与复用路径](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/daemon.go#L8240)、[LocalWorktree.Finalize](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/execenv/local_worktree.go#L509)。本地自动提交使用 `git add -A` 与 `git commit --no-verify`，不关闭 Git 签名；这不代表提交通过项目检查。清理注入文件失败、未解决冲突、提交失败或无法确认交付点时，保留 worktree 并报告异常路径，不能当作正常交付。

[GC](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/gc.go#L405)保护正在使用的环境；已完成/取消的 issue 和已归档 chat 到期后可删除环境，活跃 chat 不因空闲直接删除，chat 被删除则可在下一次 GC 回收。另有可选的已完成任务保留上限，以及只清理缓存/构建产物的路径。用户本地目录模式禁止整根删除任务日志目录。

**限制：** 托管目录保留不等于成果已交付。GC 完整删除路径主要核对归属、活跃状态和生命周期，不能从 checkout 对脏文件/未推送提交的保护推导出它们永久免于回收。`Environment.Cleanup` 虽有删除 workdir 的实现，但源码注明生产路径不调用它、由 GC 回收；不能据此判断每轮结束会立即删目录。

用户于 2026-09-29 确认轮次结束保留 worktree 供续接，随后另行明确确认独立 worktree 自动 checkpoint 与默认 Git bundle 传输。这些是 Runweft 产品决策，不是 Multica 源码行为或已实现结论。
