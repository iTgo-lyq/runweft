# 远端工作区准备实施计划

> 来源：[Requirement](requirement.md)、[Technical](technical.md)、[基线契约](baseline-contract.md)
> 状态：已完成
> 执行模式：逐任务本地提交
> 评审：当前工作区 iclaude 一次已完成；主 agent 已复核并更新分层、复用和留存方案，见 [Execution](execution.md)。按用户持续授权执行，不重复评审。

## 交付目标

提供可复用的远端基线服务及不启动模型的 Git 诊断准备：固定父仓库对象，经中心传输导入目标共享缓存，再用公共能力建立独立 worktree。输入和上下文沿现有委派能力，并通过专用原生探针验证组合启动。正式远端任务在 C10 自动调用，不增加用户必做的准备步骤。

## 关键边界

- C7 的工作区生命周期与 C8 文件通道是依赖，不能各复制一套。新增 HAPI 能力只处理仓库对象来源与缓存资产。
- 主仓库和递归子模块按 Git 对象传输，基线 LFS 单独传实体；先做高风险源导出和目标导入，再接业务编排。
- 根仓库和 HAPI 改动分别本地提交，配套 revision 随任务更新；不 push/PR/publish。
- 每个切片有无模型验收，只有实际 cwd/指令/输入和原生启动约束使用模型探针。真实跨机验收按授权单列，不能用同机两个 Runner 冒称。

## 任务

### T1 HAPI 固定基线导出

- 状态：已完成
- 依赖：已验收公共 Git 与文件能力。
- 交付：机器 repository export/inspect/release capability/API/RPC，冻结源身份与持久回执；自有 scratch bare/alternates 导出根和递归子模块 bundle、LFS 候选与清单，源仓库无写入；沿已有 Git 进程控制。重复相同 ID 不重新解析分支，确认交付后可释放自有候选。
- 验收：无 remote/未 push、移动分支、脏主工作树/子目录不影响固定 SHA；源 refs/config/工作文件/暂存区不改。源缺 commit/LFS/submodule、shallow、对象不完整明确失败。sha1/sha256 导出可独立空库导入；shallow/partial 缺对象失败且不访问源 remote，完整性放行归目标 import。
- 验证：真实 Git/LFS 文件聚焦测试、实际 Hub/Runner RPC 的导出及丢回执/重启查询；HAPI 跨包 typecheck/test，root 兼容检查。无模型执行。

### T2 目标缓存导入与已有 worktree 准备

- 状态：已完成
- 依赖：T1。
- 交付：repository import/inspect，校验 bundle/清单/实体，来源缓存共享与 target WorkspaceSource；source.snapshot 明确归属，公共 prepare 的 cache 资产逐层 hydrate/启动再校验，不回退源 URL 或 lfs pull。复用既有 prepare/finalize/remove 和仓库锁。
- 验收：两个环境共享同来源 cache、各用独立 branch/worktree；准确子目录、递归子模块和 LFS；原操作查询不重复导入，损坏资产或漂移不能 ready/launch；续接从上一封存成果继续。原本本机 worktree 行为保留。
- 验证：通过现有 capture/deliver/materialize 把 T1 输出传到另一专用数据根，上传后隐藏源路径再真实 RPC 完成 import/prepare；空库、并发/重启/损坏、公共启动拒绝与本机回归，HAPI 必需跨包检查。先完成无模型闭环。

### T3 中心准备编排与诊断 CLI

- 状态：已完成
- 依赖：T2。
- 交付：state v5 snapshot/consumer/LFS 索引与诊断记录，namespace/parent/request 归属；RemoteBaselines 编排及完整 snapshot/LFS 复用，确定文件分批/recovery pin/成功中间副本释放。Agent/runtime 选择、workspace prepare/preparations/inspect 诊断命令只创建诊断 worktree；C10 复用基线服务而不接管诊断环境或轮次。
- 验收：单一 CLI 不需填写源/目标绝对路径、Git URL 或手动传 bundle；明确 base，响应有稳定请求 ID、SHA、脏文件排除、阶段/字节/错误提示。同 SHA 多次准备不重打包或上传，另一 commit 的相同 LFS 不重传；Hub 重启/丢响应继续原记录，文件配额或导入失败不启动模型；Hub 无 Runner 也能转发和保留对象。正式远端 task/MCP 仍明确拒绝。
- 验证：真实 SQLite/API/CLI 的 local 同机拒绝及 Hub 两 Runner 准备；100+ 资产分批、配额/超时/断线/幂等/身份检查；root 聚焦和全量测试、配套构建；不修改 TaskCoordinator 的原生/轮次逻辑。

### T4 准备留存与显式释放

- 状态：已完成
- 依赖：T3。
- 交付：workspace release、基线 consumer/pin 保护；调用 HAPI 公共停止/封存/移除检查，随后解除 consumer，最后一个消费者释放才 unpin；安全缓存回收与占用诊断。沿原操作对账，错误暴露具体保留原因。
- 验收：干净 ready/失败准备可明确释放；活跃/未知执行、脏/未封存或未回收代码、其他 consumer 禁止删除；删除一环境不破坏其他环境或基线。执行机/源端离线时中心保持可恢复对象；释放丢响应不会创建第二次模型或误删其他缓存。
- 验证：真实 Runner/SQLite/HTTP 的 release、同 cache 两环境、pin/故障注入、停止探针；删除仅专用自有目录，不以测试 mock 证明磁盘副作用。

### T5 实际原生准备探针与候选安装

- 状态：已完成
- 依赖：T4。
- 交付：完整准备能力的配套构建与使用说明，仅测试中的只读 probe 通过现有 ExecutionClient/附件通道在准备后启动 Codex/Claude，各两轮复用工作树；不增加业务 probe 命令或上下文生命周期；完成整体验收、Specs 与归档另提交。
- 验收：两种 runtime 实读准备 cwd/工程指令/输入/二进制 LFS，Runweft MCP 禁用保持、原生内置工具不变；第二轮沿已有 finalize → prepare → resume，新增输入并复用原 session。失效 cwd/HEAD/inputs/模块/LFS 拒绝原生启动。源分支移走、来源/执行 Runner 停止后中心基线仍可下载校验。只把运行 probe 当本 Change 验收，不开放结果未交付的业务远端入口。
- 验证：配套编译 CLI 的同机独立 source/target Runner 和 Hub 实验、root/HAPI 适当全量检查、四平台编译/打包、本机 npm 候选安装后准备/查询/重启证据；原生会话正常停止。真实跨机器和其他 OS 本轮未实测项单列。

## 整体验证

所有 Requirement 验收项有可定位证据；真实 Git 字节、中央 pin、原生启动与版本兼容分别证明。保留未验证远端物理网络的界限，不用“基础能力存在”替代实际应用检查。最终只同步已经验收行为到 Specs，更新 C10 的消费入口，再归档。
