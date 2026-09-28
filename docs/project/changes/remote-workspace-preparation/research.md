# 远端准备的 HAPI 与 Multica 依据

> 调查日期：2026-09-28
> 来源：从初始 Change 的 Research 按职责迁移；原调查结论不因拆分变成已实现功能。

## 当前上游的跨主机执行能力

2026-09-28 核对官方文档和上游 `main` 提交 `86c88df93baf5d1f738dd4b202078bdf6dec376e`。同日拆分文档时，本地 `hapi/` submodule 也指向此提交；这只是源码关联，以下仍是文档与源码证据，未进行跨主机真实运行或兼容验收。

| 能力 | 核对结果与证据 |
| --- | --- |
| Hub 与执行机器分离 | [安装文档](https://hapi.run/docs/guide/installation#split-hub-remote-runner-peer-discovery)明确支持远端 Runner；多台机器通过各自的 HAPI CLI、Hub 地址与认证连接同一 Hub。目标机器需准备 agent CLI、原生认证和执行环境，Hub 不负责安装远端软件。 |
| 按机器启动 agent | [机器路由](https://github.com/tiann/hapi/blob/86c88df93baf5d1f738dd4b202078bdf6dec376e/hub/src/web/routes/machines.ts)提供机器发现与 `POST /api/machines/:id/spawn`；[Runner](https://github.com/tiann/hapi/blob/86c88df93baf5d1f738dd4b202078bdf6dec376e/cli/src/runner/run.ts)在目标机器的指定目录启动 CLI 子进程。可用性检查只检查可执行文件与静态配置，不证明登录和真实执行成功。 |
| 远端交互与查看 | [REST 契约](https://github.com/tiann/hapi/blob/86c88df93baf5d1f738dd4b202078bdf6dec376e/docs/api/client-contract/rest.md)提供消息、审批、中断和恢复，以及文件、Git status 和 diff 读取。这些接口不直接证明 Runweft 所需的可靠任务终态或 Git 交付。 |
| 工作区与基线 | [启动 schema](https://github.com/tiann/hapi/blob/86c88df93baf5d1f738dd4b202078bdf6dec376e/shared/src/apiTypes.ts#L642)接收 `directory`、agent 和 worktree 选项，没有仓库 URL 或基线 ref/commit；所查启动路径不执行仓库 clone/fetch 或指定基线 checkout。 |
| Worktree | [通用 worktree 实现](https://github.com/tiann/hapi/blob/86c88df93baf5d1f738dd4b202078bdf6dec376e/cli/src/runner/worktree.ts)要求目标机器已有 Git 仓库，执行 `git worktree add -b <branch> <path>`，没有传入起点，因此使用该仓库当前 HEAD。不能保证与委派方指定 commit 相同。 |

**判断：** 在已准备的远端机器和仓库上运行 Claude Code / Codex，有可复用的跨主机基础。仓库准备、指定 commit 校验及调用方可取回的代码交付，仍需在 HAPI 及其 runtime 适配边界补齐或组织流程。已有文件/diff 读取能力不能替代这三项。

HAPI 文档中的 `remote mode` 指远程控制同一执行机器上的会话；跨主机执行依赖目标机器上的 Runner。只有云端 API、无法部署 Runner 的 runtime，需要另外核对其接入方式，不能由远端 Runner 支持推断已适配。

## Multica 的任务准备与成果交付

2026-09-28 核对 [Multica 官方架构](https://multica.ai/docs/developers/architecture)及上游提交 `67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25`。以下是源码与文档证据，未部署或运行 Multica；其代码只作为设计参考。

Multica 的 daemon 在执行机器上领取任务、准备目录、启动 agent 并上报运行状态；本地和远端执行共用这条链路。具体任务采用程序与 prompt 分工，且存在“prompt 引导 agent 调用程序化工具”的组合。

| 环节 | 当前行为与证据 |
| --- | --- |
| 任务启动 | 服务端排队并通知 runtime，daemon 领取任务与临时任务凭据，再调用 provider backend；详见官方架构的执行链路。 |
| 初始任务环境 | [Prepare](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/execenv/execenv.go#L406)为常规托管任务创建空 workdir、output、logs 和任务配置目录，写入上下文、skills 及 provider 配置；不预先检出所有仓库。本地目录资源另有路径。 |
| Prompt 与按需 checkout | [运行说明](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/execenv/runtime_config_sections.go#L410)列出仓库和默认 ref，指导 agent 调用 `multica repo checkout <url> [--ref <branch-or-sha>]`；说明经 [runtime config](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/execenv/runtime_config.go)写入 CLAUDE.md、AGENTS.md 等原生入口，并配合每轮任务 prompt。 |
| Git 准备 | [CLI](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/cmd/multica/cmd_repo.go#L343)请求本机 daemon 的 `/repo/checkout`；[handler](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/health.go#L420)校验任务归属并应用项目默认 ref；[repo cache](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/repocache/cache.go#L768)执行缓存 clone/fetch、ref 解析、独立任务分支及 worktree/独立 checkout 创建，保护已有未提交或未推送工作。 |
| 项目依赖与开发 | 所查 Prepare 路径准备的是 agent 执行环境，没有统一执行各技术栈依赖安装和测试的步骤；这些由 agent 按任务、仓库说明及 skills 处理。 |
| 运行结果回传 | [runTask](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/daemon.go#L8898)读取 provider 的终态与输出；[reportTaskResult](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/daemon.go#L6245)程序化回传成功/失败、输出与会话信息。终态报告先尝试持久化到本地发送队列，成功确认后删除，网络失败可重发报告；这与重新执行任务不同。 |
| 用户可见成果 | [Output 模板](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/execenv/runtime_config_sections.go#L973)要求 issue agent 用 `multica issue comment add` 发布结果并用 `--attachment` 交付文件；聊天和 run-only 自动化另有自动回复/输出捕获规则。远端绝对路径不算可交付文件。 |
| 代码交付 | [内置平台 skill 的 issue 规则](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/service/builtin_skills/multica-platform/references/issues.md#L35)指导修改 GitHub 仓库代码的 agent 在最终评论前创建或更新 PR，并遵守用户的 local-only/no-PR 例外。[GitHub 集成](https://multica.ai/docs/github-integration)负责读取与关联 PR 状态，本身不推送提交；普通托管仓库路径的推送和 PR 交付主要由 agent 操作。 |

**不能混用的边界：**

- [本地目录的 worktree 模式](https://github.com/multica-ai/multica/blob/67d61a2073bad0fbb7140fd2000f1ab7ec0a4f25/server/internal/daemon/execenv/local_worktree.go#L509)另有程序化收尾：提交 agent 遗留改动、保留用户仓库中的结果分支，再移除 worktree；提交失败则保留现场。不能把这种同一仓库内的回收等同于远端代码已经推送并可取回。
- [Runs 文档](https://multica.ai/docs/tasks#run-completion-and-issue-completion)明确 `completed` 只表示本轮正常结束，不证明 issue 目标达成。
- checkout 接受 branch/tag/commit，但项目 ref 是可被显式 `--ref` 覆盖的默认值；缓存 fetch 失败时可继续使用缓存；已有工作可被保留。这些语义不等同于 Runweft 要求的“本次委派先固定并核验具体 commit”，不能直接照搬。

**本项目的采用边界：** 参考程序、prompt 与工具的分工，但用户已明确要求从主仓库派生独立 worktree，且必须在 subagent 会话启动前准备 Git、目录、输入和上下文。不能沿用 Multica 由 agent 按需初始化任务根仓库的时机。项目依赖仍由启动后的 agent 处理，具体方案见[工作区准备设计](design.md)。


启动关联及上传证据见[执行基础调查](../hapi-subagent-foundation/research.md#远端设计补充证据)；代码传输实验见[结果回收调查](../remote-result-delivery/research.md)。Multica 表格中的结果相关证据供相应 Change 引用，不扩大本 Change 实现范围。
