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


启动关联及上传证据见[执行基础调查](../../archive/2026-09-29-hapi-subagent-foundation/research.md#远端设计补充证据)；代码传输实验见[结果回收调查](../remote-result-delivery/research.md)。Multica 表格中的结果相关证据供相应 Change 引用，不扩大本 Change 实现范围。


## 2026-09-29 实现前复核

本次检查根仓库 `76212cb`、配套 HAPI `c4c432ab0b376d254bf21571f4aaf51cbe3251f4`。上述 9 月 28 日上游调查是历史依据，不能代表当前配套实现。

| 已有实现 | 本 Change 的复用点与缺口 |
| --- | --- |
| HAPI `cli/src/runner/workspaces/manager.ts` | resolve 固定 commit/commonDir/相对 cwd；prepare、finalize、remove、launch 已有持久回执、仓库锁与进程归属。source 当前要求本机 machineId/commonDir，不能直接接受另一机器的路径。远端应导入本机缓存，再产生本机 source；保留上层 origin 身份，不削弱原检查。 |
| HAPI `cli/src/runner/workspaces/git.ts` | 已有 Git 子进程超时、终止核对、stderr 限制与环境清理。bundle 写入文件，不经过 16 MiB stdout 缓冲。沿用执行工具，不新增通用执行器。 |
| HAPI `cli/src/runner/artifacts/` | capture 固定候选、deliver、materialize、inspect、release 已可传任意文件，无需会话。单次最多 100 项，较多 Git/LFS 文件可按确定批次复用现有操作。中心已有 namespace、hash/长度、配额与 recovery pin。 |
| Runweft `src/tasks/coordinator.ts` | 当前明确拒绝跨机任务；TaskWorkspaces/TaskFiles 已在原生启动前完成准备，context 在中心固定后传原生入口。本 Change 保持正式远端 spawn 的拒绝，输出可由 C10 消费的准备记录。 |
| 数据布局 | 中心业务 `state.sqlite`、HAPI 中心 artifacts、每连接 Runner HAPI_HOME 已集中；新增 Git 导出与仓库缓存归 HAPI_HOME/workspaces，不放随机系统临时目录。 |

### Git 原语实测

在 `.dev-smoke/remote-preparation-research/` 中使用专用仓库和局部 Git/LFS 配置，未改用户全局配置。环境 Git 2.39.5、Git LFS 3.3.0。

成功证据：`.dev-smoke/remote-preparation-research/git-9c3qehqo/evidence.json`，`success=true`。验证完整 bundle → 空 bare cache 导入/fsck → 两个共享对象库的独立 worktree；源 dirty/untracked 不进入目标。子模块 commit 独立打包，目标以命令级本地 cache URL 初始化，再按 oid/size 放入 LFS 实体并执行原生 checkout，文件逐字节一致。sha256 仓库使用自身对象格式导入成功。

补充证据 `.dev-smoke/remote-preparation-research/fixed-lfs-v_seb41s/evidence.json` 验证：源端 LFS 文件已提交为新内容后，`git lfs ls-files --json <旧 commit>` 仍返回旧 oid/size，允许按固定基线导出，不必 checkout 或读取当前工作文件。

递归补充证据 `.dev-smoke/remote-preparation-research/nested-g9ndzbiv/evidence.json`：两层子模块分别以完整 bundle 导入 cache，将三个源路径移走后，仅用命令级本地 cache URL、逐层 `submodule update --init --checkout` 完成初始化；含空格模块路径通过，HEAD 与 gitlink 一致、工作树干净。

浅克隆两提交 fixture 的 bundle 在空仓库 `verify` 返回 0，但 `fetch` 返回 1。因此 `bundle verify` 单独不足以证明完整闭包；源端拒绝 shallow，并在独立空对象库实际导入和校验选定 commit。partial clone/alternates 同样以独立导入结果判断，不能依赖源端隐藏的对象来源。

初次实验把 bare HEAD 指到 `refs/hapi/...`，Git worktree 拒绝“HEAD not found below refs/heads”；改为受控 `refs/heads/cache-base` 后成功。该分支只提供正常 bare HEAD，业务基线仍是单独不可变 ref；后续导入不移动它。另一轮失败是实验 mkdir 未允许已存在 LFS 目录，修正 fixture 后通过，不是产品实现验证。

**证据边界：** 上述仅验证 Git/LFS 原语，尚未接通 HAPI RPC、中心附件、程序化准备或原生模型，不代表远端应用已交付。当前主仓库中的 HAPI submodule 也说明：仅从 `.gitmodules` URL 拉取不足以覆盖尚未 push 的子模块提交。

### 方案推导

- 使用主仓库及基线引用的各子模块 bundle，LFS 按内容对象单独传输；避免依赖执行机能访问源机绝对路径、Git remote 或临时凭据。
- 源端从固定 commit 的树枚举资产，不能从后来移动的 HEAD 或脏工作树推断清单。源端缺少子模块提交或 LFS 实体时提示先取得对象，不自动 fetch/checkout 用户仓库。
- 保留来源身份与执行缓存身份两份不同含义的记录。缓存按来源 repositoryId 复用，同一来源的并行任务共享 cache，各 environment 独立 worktree；不是每会话 clone。
- Hub 只需原有文件服务持久保存经源端验证的基线对象和 pin，本 Change 不要求无 Runner 的 Hub 安装 Git。目标 import 再独立验证；C10 的成果验证方式在其 Technical 中落实。


### iclaude 建议的独立验证

评审提出用自有 scratch bare 的 alternates 导出，消除源 ref 写入及其释放依赖。主 agent 在 `.dev-smoke/remote-preparation-research/scratch-17kszxiw/evidence.json` 独立实测：完整源导出成功，源目录移走后 bundle 仍可导入空库/fsck；shallow 因缺父对象失败，partial 因缺 blob 失败；三种情况源 refs 均未改变。采用此路径，去掉源端额外一次全量验证导入，保留目标独立导入放行。

另一个实验 `.dev-smoke/remote-preparation-research/no-fetch-faraexk6/evidence.json` 证实原 promisor 仓库直接 bundle 会尝试懒取缺失对象；空 `GIT_ALLOW_PROTOCOL` 将其阻止。按 [Git 官方环境变量说明](https://git-scm.com/docs/git)，源读取/导出命令使用空协议白名单，目标导入只在处理自有已校验文件时允许 file。这是 Git 对象准备的副作用控制，不是新的 agent 权限沙箱。

评审的缓存来源标识建议采用显式 source.snapshot；其仅检查 LFS checkout 标志的性能建议与现有 Git clean 检查组合使用，准备时仍完整校验实体。相同快照与 LFS 复用、中间副本及时释放、C10 不接管诊断环境均纳入最终 Technical；上方“方案推导”只作为推导依据，最终契约以 Technical 为准。


## 2026-09-30 T1 实现验证发现

Git LFS 3.3.0 在源仓库执行 `ls-files --json` 时可能补写 `lfs.repositoryformatversion`；看似只读的命令也不能直接用于“源配置不改”的导出。T1 把枚举移到 scratch bare，源端只通过 Git config 读取 lfs.storage，再按 oid 读取对象。自定义相对 storage、linked worktree 与递归子模块的真实测试通过。

已冻结 source 的重新校验跳过 dirty 刷新，避免 Git status 通过 LFS clean 重新创建源对象；只有身份和固定 commit 参与校验，保留最初 dirty 提示。现有本机 resolve 默认行为不改。

HTTP 故障探针最初只调用 Bun Node HTTP ServerResponse.destroy，实际并未可靠断开 socket，因此“应该收到连接错误”的断言失败。补充代理请求记录并显式关闭 socket 后，确认只有一条 export 转发、调用方收到 connection_failed，随后查询及重启恢复同一操作。不能把第一次现象归因为客户端自动重试；HapiClient 本身不重放不确定业务 POST。


## 2026-09-30 T2 实现验证发现

仅通过命令级 `-c submodule.<name>.url=<cache>` 做 update，会把文件检出，但不会持久登记初始化状态。第一次真实 Hub/双 Runner probe 的 prepare 成功，公共 finalize 却因 `submodule status` 仍为未初始化而失败，见 `.dev-smoke/repository-import-x9S0is/evidence.json`；服务均已停止、无原生会话。

修正为受管 bare 开启 `extensions.worktreeConfig`，把 bare 的 `core.bare=true` 移到自身 `config.worktree`；每个 checkout 用 `git config --worktree` 登记模块 URL/active，并继续逐层显式 checkout 与禁用网络 fetch。这样同来源缓存的不同环境不会相互改写模块登记；原有公共 status/finalize/remove 可以直接识别，未增加第二套封存逻辑。两层重名模块、根改动封存再准备的聚焦测试，以及真实 RPC 的封存、重启、续接、删除另一个环境均通过。

只安装 git-lfs 可执行文件，不等于已经设置全局过滤器。导入/准备只在自有 cache/模块配置 `git lfs install --local --skip-repo --skip-smudge` 与本地 storage，不安装 hooks、不改全局配置。禁用全局/system Git 配置的真实测试验证初始 LFS、变更 LFS 封存、下一轮复用实体和损坏实体拒绝；没有 lfs pull 回退。Git clean 和 LFS checkout/downloaded 组合拒绝 pointer-only 启动，不依赖某个单一错误码。

完整导入必须进入独立空库，即使共享 cache 已具备历史对象。测试用同一基线生成带 prerequisite 的增量 bundle 并更新正确摘要，目标仍在空库验证阶段拒绝，已有成功快照不受影响。导出与导入共用固定 gitlink/LFS 枚举助手。

实际无模型闭环 `.dev-smoke/repository-import-vfcKCF/evidence.json`：Hub 无 Runner；源端 capture/deliver 后移走所有源 fixture 路径、释放 export/spool 并停止源 Runner；另一身份与数据根 materialize/import，再释放下载副本；两独立工作树准确读取子目录和模块二进制 LFS；重启查询原 import、从封存成果准备下一轮，移除另一干净工作树后保留缓存 refs。success=true、cleanupErrors=[]。这是同机独立 Runner 验证，不能替代跨物理机器或原生 agent 验收。

## 2026-09-30 T3 编排与诊断验证

目标导入需要独立代次：一次明确失败不能污染可用中心快照，也不能让新消费者改写旧准备所关联的失败回执。实现按 snapshot/目标机器生成 import 代次；故障测试修复目标后，只重新下载/导入，中心不重复发布。丢失发布响应先查原 deliver，Hub 重启沿持久批次和 ID 继续；未知 capture/export 不重新执行。

文件发布可能部分成功。`deliver` 回执中的 available 项经摘要/大小和 request ID 匹配后记录 recovery pin，再按名称释放这些 export/capture 副本；未发布候选继续保留。测试证明部分失败不会等待全批成功才释放已交付字节，也不会删除剩余候选。

配套 CLI 实验 `.dev-smoke/workspace-preparation-M6ji4H/evidence.json` 在接受准备后立即重启 Hub，完成 103 个真实 Git/LFS 文件的分批传输，并验证相同 request 返回同一记录、同提交不重复上传、新提交只传新 bundle、源目录隐藏/Runner 停止后的持久查询。另有 local 部署同机目标拒绝；全程没有原生模型会话。首次脚本因把格式化 CLI JSON 当单行 JSON 解析而失败，修正为解析完整 stdout 后通过，不能把脚本解析错误视为产品失败或成功证据。
