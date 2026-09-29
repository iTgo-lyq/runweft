# 远端任务启动前的工作区准备

> 状态：已确认
> 规模：大型
> 更新：2026-09-29
> 确认依据：远端任务必须继承 Git 主工作区；各 subagent 独立 worktree，后续轮次复用；启动前完成 Git、目录、输入和上下文，依赖由 agent 按需安装。2026-09-29 用户确认通过 bundle 传输已提交基线，支持未 push 或没有 remote 的仓库。

## Review 导读

远端 subagent 在确定的主仓库基线上开始工作，不负责通过首轮 prompt 自行初始化任务根仓库。本 Change 的验收边界是“环境已准备，并且只有有效环境才能启动”，不包含开发结果回收。

通过 bundle 传输已提交基线、支持未 push 或没有 remote 的仓库已确认；具体传输、保留和失败处理见 [Technical](technical.md)；[Design](design.md)保留前期讨论。

## Change 依赖

| 关系 | Change | 依赖内容与满足条件 |
| --- | --- | --- |
| 前置 | [HAPI 执行契约](../../archive/2026-09-29-hapi-subagent-foundation/requirement.md) | 目标机器与稳定启动关联；本 Change 在 HAPI 内补准备与启动校验，不另建执行器 |
| 前置 | [本地工作区执行](../../archive/2026-09-29-local-workspace-execution/requirement.md) | 公共 Git 环境身份、确定基线、worktree 准备及启动检查已验收；远端消费同一能力 |
| 前置 | [任务附件](../../archive/2026-09-29-task-artifact-delivery/requirement.md) | 会话创建前可取回、校验并保留输入；bundle 作为输入时也沿此路径 |
| 下游 | [远端代码回收](../remote-result-delivery/requirement.md) | 消费环境身份、固定基线和可恢复基线对象 |

## 独立验收与交付边界

可用已授权的准备请求与原生启动验证独立验收跨机 Git 来源、输入落地、缓存与准备回执，不要求远端结果服务先实现。委派和本地工作区已是上游；本 Change 不重复定义其身份、Git 生命周期或调度状态。

完整远端代码委派须等本 Change 与远端结果均验收后开放。准备验收可使用专用探测任务，但不能把“可启动、不可取回代码”作为正式功能；实际组合由远端结果 Change 验收。

## 行为变化

### ADDED

#### `remote-workspace/baseline`：从主 Git 工作区派生

拒绝非 Git、无 commit、缺少明确基线的远端请求。将主 agent 指定的分支或 commit 解析并固定为本次 SHA；主分支之后移动不改变基线。未提交和未跟踪文件不会自动同步，必须明确说明排除范围。

默认可通过 Git bundle 传输已提交基线，支持无 remote URL 或基线尚未 push 的仓库；不要求先向 Git 托管平台推送。

#### `remote-workspace/isolation`：独立并可复用的工作区

每个 subagent 从同一主仓库派生独立 worktree；不同 subagent 隔离写入，同一 subagent 后续轮次保留工作区与改动。主工作区的新提交不自动同步到活跃远端环境。

这里的 worktree 用于代码改动分离，不增加执行权限隔离。任务结束关闭子执行进程，worktree 和原生 session 记录分别保留；不得为了兼容 runtime 改用每会话独立 clone。

#### `remote-workspace/readiness`：准备完成才启动

Git 基线、目录、输入附件和上下文准备并校验完成后，才允许启动 agent；任一必需项失败则没有 agent 进程。启动时还需防止使用已经失效或被改动的环境。项目依赖由 agent 启动后安装。

## 验收标准

- [ ] 非 Git、无 commit、ref 歧义或未指定基线的请求被拒绝，没有远端 agent 进程。
- [ ] 主分支移动后实际远端 HEAD 仍等于冻结 SHA；未提交内容明确排除。
- [ ] 无 remote 或基线尚未 push 时，可通过 bundle 完成准备；不自动推送主仓库。
- [ ] 两个 subagent 可在同仓库独立 worktree 运行；续接复用原环境，不重置已有改动。
- [ ] 缺少必需附件、错误 hash 或上下文不可用时拒绝启动；旧准备回执不能放行被改变的环境。
- [ ] LFS、子模块、浅克隆或对象格式所需能力不具备时明确拒绝，不静默提供残缺目录。
- [ ] 准备回执丢失可查询原操作，未知 spawn 不导致重复 agent。

## 准备操作的产品边界

提供不启动模型的 Git 准备与诊断入口，复用现有 Agent/runtime 选择、请求身份、文件通道和数据根；用户无需手工 clone、上传 bundle 或填写远端绝对路径。正常远端委派将在下游 Change 自动复用基线服务，再继续已有工作区、输入和上下文流程；不要求先执行诊断命令，也不接管诊断环境。相同 namespace、源仓库和 commit 复用恢复快照，LFS 实体按内容复用。

固定基线包括主仓库 Git 历史、该 commit 所引用的递归子模块提交，以及该基线工作树需要的 LFS 实体。源端没有必要对象时明确拒绝并提示先在源仓库取得它们；不自动改动源工作树、refs、初始化子模块或修改用户 Git 配置。未提交子模块修改同样排除。

准备记录和 worktree 默认保留，支持查询与显式释放。释放不得删活跃/未知执行、未封存修改或被其他环境/成果引用的唯一恢复对象。

2026-09-29 用户持续授权主 agent 落实细节、逐任务提交与本地自动验收；本 Change 的一次 iclaude Plan 评审完成后执行。

## 已确认的传输策略

2026-09-29 用户确认上述 bundle 与仓库支持范围。基线对象需保留以支持后续验证与取回；首传成本、来源复用与配额在正式方案中落实。

## 协作资源

- [远端 HAPI 与 Multica 调查](research.md)（2026-09-28）：Multica 的按需 checkout 由程序执行，但初始化时机不沿用；HAPI 现有 worktree 启动不固定主机选择的 commit。

- [Git bundle](https://git-scm.com/docs/git-bundle)、[Git submodule](https://git-scm.com/docs/git-submodule)、[Git LFS 文件枚举](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-ls-files.adoc)（读取 2026-09-29）：完整 bundle、Git 原生子模块初始化与固定 commit 的 LFS 枚举；本地原语实验与当前 HAPI 差距见 [Research](research.md#2026-09-29-实现前复核)。

- [Git 环境变量](https://git-scm.com/docs/git)（读取 2026-09-29）：协议白名单与 replacement refs 控制用于固定对象导出；不改变原生 agent 执行权限。
