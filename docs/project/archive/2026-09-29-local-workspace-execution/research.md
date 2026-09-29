# 独立工作区调查

## 已验证的基础

调查基于 HAPI `56ec77f19322619a429304e7a948ba2c46eaca4d`，Runweft 委派已验收版本 `2ab40aa`。本文件的源码事实与 Git 实验不等于目标工作区功能已经实现。

| 事实 | 证据与影响 |
| --- | --- |
| HAPI 可创建 worktree，但与会话启动绑定 | [runner/worktree.ts](../../../../hapi/cli/src/runner/worktree.ts) 的 createWorktree 从默认 HEAD 创建 `hapi-*` 分支，放在仓库旁；不接受固定 commit/目标路径/准备身份。removeWorktree 使用 --force，不能直接作为成果安全清理 |
| 已准备目录可以直接启动 | [runner/run.ts](../../../../hapi/cli/src/runner/run.ts) 的 simple 分支先验证目录，再走现有 launcher；worktree 分支会另建目录。应使用 simple + 准备引用，不能再次选择 sessionType=worktree |
| 当前机器级 RPC 没有 Git 生命周期 | [apiMachine.ts](../../../../hapi/cli/src/api/apiMachine.ts)、[machines route](../../../../hapi/hub/src/web/routes/machines.ts) 提供目录、存在性、模型与 spawn。Git status/diff 是[会话级 RPC](../../../../hapi/cli/src/modules/common/handlers/git.ts)，启动前无法借它准备 |
| 认证与路径边界可复用 | Hub requireMachine 限定 namespace；[MachinePathPolicy](../../../../hapi/cli/src/api/machinePathPolicy.ts) 核对真实路径与可选 workspace roots。默认沿执行账户权限，不另建隔离 |
| 续接仍经过机器 spawn | [syncEngine.ts](../../../../hapi/hub/src/sync/syncEngine.ts) resumeSession 使用现有原生历史和 rpcGateway.spawnSession；需将准备引用穿过通用启动/恢复入口，无须改 runtime adapter |
| 委派已有持久接受和逐任务协调 | [coordinator](../../../../src/tasks/coordinator.ts) 在输入前保存身份，每轮 archive/确认停止后结束；目前准备/finish 固定为 shared。扩展环境提供方和 finishing，不创建另一个任务引擎 |
| 数据布局已有唯一连接目录 | [config.ts](../../../../src/config.ts) 将 Runner HAPI_HOME 固定为 `<Runweft home>/connections/<connection>/hapi`；机器侧持久环境可以放在其下，中心只保留业务引用和事实 |

## Git 实验

当前 Git 2.39.5、Git LFS 3.3.0。专用实验 `.dev-smoke/local-workspace-research/probe.py` 及 `evidence.json` success=true；未修改用户配置或项目工作区。

- 已提交基线创建 linked worktree，不带入主目录暂存与未跟踪文件；工作树使用同一 common Git directory，可从子目录确认仓库身份。
- 子 agent 已有提交后，普通 git add/commit 可以补文本、二进制和删除的 checkpoint；主目录 HEAD、index 与状态保持原样。Git `update-ref <ref> <sha> <zero>` 可拒绝覆盖既有不可变成果。
- pre-commit 返回非零时保留改动和 index，HEAD 不变；不能把 hook 失败解释为代码已交付。
- `rev-parse --verify --end-of-options ambiguous^{commit}` 对分支/标签同名返回 0，同时 stderr 警告歧义。解析必须检查歧义，不能只看 exit code。
- 普通 `git worktree remove` 会删除 ignored 文件。程序必须单独检查 ignored 内容，显式丢弃后才可删除。
- 子模块 worktree 默认未初始化；显式 submodule update --init --recursive 后对应 commit 的内容才可用。含子模块的干净工作树也不能直接普通 remove，受控删除须先验证嵌套状态和保留条件。
- LFS 在 skip-smudge 下只检出指针；git lfs checkout 可从同仓库对象恢复实体。`git lfs ls-files --json` 提供 oid/size/checkout/downloaded，准备应确认内容而非只看 checkout 命令成功。

评审后补充 `.dev-smoke/local-workspace-research/submodule-config.py` / `submodule-config.json`：新建未初始化子模块的 linked worktree，原生 init 实际修改共享 `.git/config`；为已解析的绝对 URL/active 使用本次 `-c` 配置可完成相同初始化而不写共享配置。实验仅以本次 `-c protocol.file.allow=always` 使用自有 file 源，不放开产品默认 file 协议，也不代表远端凭据已验证。相对 URL/复杂递归仍按原生语义在 T1 验证，不自造 URL 解析器。

本机 Git 附带的官方 `RelNotes/2.31.0.txt` 确认 rev-parse 在 2.31 增加 --path-format，版本要求据此固定；LFS JSON 能力另按实际命令探测。

## 一次评审补充的源码事实

- HAPI spawn schema parse 后才计算 request 指纹，Resume schema/SyncEngine opts 目前仅含 permissionMode；ExecutionClient.resume 请求体为 `{}`。准备引用必须贯穿 schema、指纹、Hub/RPC、Runner 与调用层，不只是给 Runner 加参数。
- HAPI simple 启动默认允许创建不存在的目录；受控准备校验必须先于此步骤并禁用自动创建，否则删除的 checkout 会变成空目录。
- Runweft HapiClient 默认 10 秒、Hub RPC 默认 30 秒、Hub HTTP 有 idle timeout。子模块/LFS 和 hook 可能超时，机器受理回执 + inspect 查询比占住请求等待更适合现有栈；不是实际运行过这些新接口的证据。
- Runner 已有持久 processStartMarker、verifiedExit 和按 session 的 Codex shared runtime 记录；收尾/清理优先复用，不把共享 runtime 公共 PID 退出当成本 root 停止。
- 当前 TaskStore.save 只更新 round/revision，next 接受事务尚未检查环境状态；T2/T3 需补持久 Task 环境更新与删除互斥。

## 方案结论

固定基线、准备回执、封存与安全删除是已证明的 HAPI 接口缺口，沿 Runner 的 Git/机器 RPC 增补；不以启动一个空 agent 或通用远程 shell 代替。Runweft 只提供主仓库/轮次归属、调用顺序与结果展示。

自动 checkpoint 使用显式机器身份，不继承用户作者名；保留 hook/签名策略，缺少签名配置等失败由用户/主 agent 修复后显式重试。Git 配置仅对本次命令生效，不修改全局配置。

子模块初始化与子模块成果传输不同：本 Change 验证前者，后者不冒充父仓库 Git 对象的一部分；变更 gitlink 或嵌套脏状态明确阻止自动封存。远端准备/结果继续负责对象来源和传输，不让本地阶段预建网络协议。
