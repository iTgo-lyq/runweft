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

## 2026-09-30 实现前复核

基于当前配套 HAPI `0d7618c3fe7d20ac10be2954e57a00d59431bba9` 和 Runweft C9 归档状态复核：

- HAPI WorkspaceManager 已持久封存 base/start/result/ref 和停止依据；RepositoryManager 已从固定来源导出完整根/模块 bundle 和 LFS，RepositoryCache 在独立空库验证 bundle/fsck/清单后导入。缺口是“从受管成果直接导出并带验证回执”和“只向原主仓库导入成果对象/专用引用”，不需要新的执行器或原生 adapter。
- `resolveSource` 要求有工作树，不能直接把导入的 bare sourcePath 当成果导出 cwd。使用受管 checkout 根及已封存 resultRef 可准确导出，也不依赖业务 cwd 是否仍存在。next round 应在不可变候选捕获后放行，不能让上传重试依赖后来变化的 checkout。
- 当前 cache 回收拒绝任何非初始成果，即使中心已经发布；需要公共 remove 的明确成果 ref 释放事实，保持默认本机行为与未知 ref 保护。业务层不能靠直接删 cache 绕过。
- RemoteBaselines 的 consumer 目前都绑定一个目标 import；结果对输入基线的依赖只需要中心保留，不应因此永久占住目标缓存。评审后采用代码清单直接 pin 依赖文件，不新建 result consumer 或修改 importId；诊断与任务仍共享同一个 baselines 实例及锁。
- TaskCoordinator 的 prepare/finalize/stop/resume 与 TaskFiles/TaskOutputs 可继续使用。跨机拒绝位于客户端、accept 和 queued；只在基线、交付、取回、清理形成闭环后解除。schema 中 base 默认值不能抹掉远端用户是否明确指定基线的事实。

专用无模型实验 `.dev-smoke/c10-result-research-14IO6t/evidence.json` **success=true**：真实调用现有 HAPI 导出/导入/prepare/finalize，在源路径与模块 URL 不可用时，修改二进制 LFS 并封存，从受管 resultRef 导出；独立接收库验证完整成果与初始 base 祖先关系。随后隐藏执行端，删除原主分支，制造主目录 staged/unstaged/untracked 内容，再用验证后的 Git 对象导入专用 ref、LFS 及缺失模块对象库；主 HEAD/config/index/文件/status 保持相同且没有 FETCH_HEAD 写入。恢复的未初始化模块可在后续显式 `submodule update --init --no-fetch` 中正确检出，无需原 URL。

首次实验 `.dev-smoke/c10-result-research-pUklk0/evidence.json` 在上述取回不变性检查通过后，模块的显式初始化失败：简单复制 bare cache 会留下 core.bare=true，Git 后续设置 core.worktree 后配置冲突。修正只对新创建的原生模块对象库设置 core.bare=false；不改已有模块/主仓库配置，再验通过。嵌套、重复 module name、已有自定义 storage 和故障恢复由正式 T2 覆盖，不能用这一个模块实验宣称完整应用验收。

该脚本使用 Bun 直接加载 HAPI 源文件，退出时报告 tsconfig directory mismatch 内部警告，但修正实验 exit=0、全部断言和 evidence 成功；正式配套编译程序与 RPC 的验收仍须逐任务执行。

消费者迁移原语实验 `.dev-smoke/c10-consumer-migration-34tvyf5h/evidence.json` **success=true**：复制已停止的 C9 真实 v5 业务库，在事务内将 repository_consumers.importId 放宽为 nullable，14 张原表、11 条原行逐项保持不变，插入只保护中心的 result consumer 后 foreign_key_check 仍为空。实验仅证明该形式可行；评审后选择直接文件 pin，不采用 nullable consumer 迁移。正式 v6 只新增代码结果表，T3 用包含既有任务/附件的 v5 数据验证旧表/行全部保留。

方案据此选择完整成果快照，复用 C9 的导出/独立验证/文件通道；同结果 HEAD 复用快照，LFS 按内容复用。初始设计中的增量 bundle 是建议而非已确认交付条件，本轮不增加增量前置链。中心继续无 Git/Runner：可信机器导出回执提供 Git 语义验证，中心核对封存关联、清单和持久文件，取回端再次独立验证；不能把字节上传成功等同于语义或业务验收。

评审复核补充：完整 Git bundle 只含 LFS 指针，不含初始基线中后来被替换或删除的 LFS 字节。去掉 result consumer 后，代码清单须内嵌基线与成果两端的恢复文件映射、直接 pin 去重集合；不能把“完整 Git 历史”误写成“全部旧 LFS 已在结果包”。模块 bundle 可按固定 commit/format/映射复用已验证 artifact，保留原 bundleRef/摘要，不以重新打包得到的随机 hash 判断内容身份。


### T2 原生模块对象库的最小初始化

`.dev-smoke/c10-fetch-module-7mgxkg2d/evidence.json` 成功：原生 submodule deinit 后移走模块 Git 目录和上游，仅新建同名 bare 对象库、设自有 core.bare=false、导入专用 ref，不设置 HEAD 或复制旧配置，后续显式 `submodule update --init --no-fetch` 可恢复 checkout。因此 fetch 只为新建模块对象库写初始配置；含 LFS 的新模块库还需初始本地 filters（`lfs install --local --skip-repo`，不安装 hooks）；否则在没有全局 LFS 配置时，原生命令无法把已恢复实体检出。已有模块的 config/HEAD 保留，校验其 gitDir/commonDir/format/core.worktree 与预期层级映射。模块成果 ref 在根成果 ref 前发布，原工作文件由后续显式 Git 接纳命令处理。
