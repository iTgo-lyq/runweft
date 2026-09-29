# 远端代码回收执行概况

## Plan 评审

本 Change 唯一一次 iclaude 只读评审已完成，session `d215c3f1-50fa-4a14-b0ce-cd92e777f994`，2026-09-30 02:06–02:18（Asia/Shanghai），exitCode 0、result success。仅开放 Read/Glob/Grep，无 MCP、无子 agent、无文件修改。结论为核心方案可执行、无硬阻断；主 agent 逐项复核如下，不再重复评审。

| 建议 | 独立判断与落实 |
| --- | --- |
| 用成果清单直接持有恢复文件，取消 result consumer/nullable importId | 采纳简化，v6 只增加表。但完整 Git bundle 不含旧 LFS 实体，因此清单必须内嵌初始基线与成果两份文件映射，并 pin 去重集合。只保留成果 HEAD 的字节不足以恢复基线。 |
| 复用未变化模块、明确全量包配额代价 | 采纳发布阶段按 path/module/format/commit 复用已验证 artifact，保留原 bundleRef/hash；不为免除打包增加持久缓存。显示上传/复用/保留字节和准确清理、配置命令。 |
| wait 后正常即可 fetch，细分补交动作 | 采纳 seal → TaskResults → TaskOutputs → finished，初次发布先得出确定结果；补交使用 code_revision。code.next 区分 retry_result 与 retry_artifacts。 |
| 提前证明真实封存接入和 C9 回归 | T3 用实际 HAPI prepare/finalize facts 驱动 TaskResults；提取传输逻辑后立即跑 C9 实际诊断。T4 验证共享 baselines、origin/target 分离与 consumer 插入后崩溃。 |
| fetch 防止 Git 配置引入隐式副作用 | 采纳操作级空 hooksPath、禁递归/自动维护/commitGraph、no-write-fetch-head、本地协议；直接恢复 LFS。以 reference-transaction hook 和目标配置证明。 |
| 确定捕获失败后允许明确放弃 | 采纳严格限定的 discard-pending：原生停止、Git sealed、相关操作确定停止；保存 tombstone 后放行后续 prepare，未知操作不能绕过。首次基线失败提示按原固定 SHA 新 spawn。 |

另补齐两处源码风险：成果错误不能被当前 finishing catch 覆盖成 Git unknown；结果重试必须覆盖捕获失败但仍在 finishing 的轮次。共享依赖关闭顺序改为先等待 tasks 再关闭 preparations/store。T5 校验 cache 的 changed/ref allowlist 消费精确 ref 释放事实；T6 增加无 remote 和递归未变模块。

原始评审记录：`.dev-smoke/reviews/remote-result-delivery/{meta.json,events.jsonl,review.md}`。需求、技术与 Plan 的持续自主执行授权有效；本次规划提交不表示目标行为已经实现。

## 实施前证据

- 现有 HAPI 成果导出、独立导入与 Git/LFS/模块对象恢复原语：`.dev-smoke/c10-result-research-14IO6t/evidence.json` 成功；首次 bare 模块配置失败及修正见 Research，尚不构成新 API 或正式应用验收。
- nullable importId 迁移原语：`.dev-smoke/c10-consumer-migration-34tvyf5h/evidence.json` 成功；14 张原表/11 条原行不变。评审后选择更小的直接 pin 方案，不采用该表迁移；正式 v6 与完整旧任务/附件数据留在 T3 验证。
- 规划仅修改文档，未修改运行代码或 HAPI revision；结构、本地链接和 diff 检查通过。
- Commit：`remote-result-delivery: confirm reviewed recovery and delegation plan`


## T1 HAPI 已封存成果的验证与导出

- 结果：公共 repositories 增加 export-result 与 repositoryResults:1，沿原机器认证/namespace/RPC/inspect/release；WorkspaceManager 读取归属、停止、准备与 sealed facts，按公共仓库锁保护捕获。导出从 checkout 根读取准确 ref，先固定全部文件，再用从 C9 提取的独立验证器检查根/递归模块/LFS、完整闭包与 base → start → result 关系；持久 sealed/snapshot 后删除 scratch/verify。后续轮次与重启查询不再读取旧 checkout，不产生新 checkpoint，原生 adapter 未改。
- 聚焦验证：HAPI repository results/cache/export 和 workspace manager 共 40 项通过；覆盖 sha1/sha256、无改动、partial、新二进制 LFS、递归模块、源路径离线、删除任务 cwd、两轮独立候选、ref/祖先漂移、未封存/活跃执行拒绝、捕获锁与中断原 ID 查询。Hub 21 项/113 断言通过，包括新 capability、namespace 和拒绝上传者填写 resultHead。
- 跨包验证：HAPI 全部类型检查、root typecheck 通过。全量 CLI 3020 pass / 11 skip / 1 fail；唯一失败是已有 skills 测试把 /tmp 子目录视为非 Git，而环境保留 /tmp/.git，未改无关测试或该目录。顺序总命令被此失败终止后，补跑其余包：Hub 1413 pass / 3 skip，Web 3249 pass，Shared 323 pass，Relay 118 pass。fixtures 生成无差异；不宣称全量全部绿色。
- 实际验证：新增 `bun run test:result-export`，证据 `.dev-smoke/repository-result-export-c2xyiU/evidence.json` success、cleanupErrors=[]。真实 Hub 无 Runner，source/target 为不同机器身份和数据根；基线先经文件通道导入，源停机且目录隐藏后准备任务。两轮无模型封存/导出包含新 LFS 和未变模块，第二轮 partial 且删除原 cwd；真实 HTTP 丢响应和 Runner 重启回原回执。发布后释放候选、停两端 Runner 并隐藏执行端 Git 存储，中心下载全部文件，空库 bundle verify/fetch/fsck 和祖先关系、LFS/hash/size 均通过；无 native session。该验证为同机多进程，不冒称物理跨机。
- 配套构建：HAPI 通用实现已在独立仓库提交，root 更新固定 revision；从干净 pin 构建 linux-x64 HAPI/Runweft 并执行上述 RPC。四平台包在 T6 重建。C9 共享校验器的导入/准备/清理回归已通过，中心及远端业务入口尚未开放。
- Commit：HAPI `remote-result-delivery T1: export independently verified sealed results`；Runweft `remote-result-delivery T1: verify sealed exports through paired runners`


## T2 HAPI 向原主仓库取回对象

- 结果：新增持久 fetch-result，原仓库身份解析从 resolveSource 提取，不要求原 branch/HEAD/base 对象存在。baseline/output 材料分别固定并复用独立校验；验证原来源、树、未变模块、祖先和路径 facts 后，按公共锁追加根/模块对象及基线/成果 LFS。目标 Git 命令使用自有空 hooksPath、禁递归/自动维护/commitGraph、no-write-fetch-head、无 branch refspec；最后 CAS 专用 refs/hapi/results。已有配置/HEAD/index/工作文件不变；新建模块只初始化原生 core.bare 与必要本地 LFS filters（skip-repo，不装 hooks）。操作副本归 workspaces/fetches，release 不删除原仓库对象/ref。
- Git 验证：5 项综合取回测试通过，含 sha1/sha256、源分支删除、stage/dirty/untracked/FETCH_HEAD/config 字节保护、reference-transaction hook、重复/冲突 ref、recursive/repeated-name 模块、模块 LFS、旧/新 LFS 与 custom storage、模块已初始化配置保护和映射拒绝。原 base 对象移走后仍可通过 linked worktree 取回；错误克隆拒绝。字节损坏先于目标写入，部分追加失败无成果 ref；修复后沿原 ID 查询不会重跑，显式新 ID 成功。最后补强的中断回执测试单独 1 pass / 4 filtered，通过原 ID 对账而不重启写入。
- 回归与跨包：C9/T1 的 40 项聚焦回归通过；最终全量 CLI 3025 pass / 11 skip / 1 fail，仍只有已记录的 /tmp/.git 导致 skills 非 Git 假设失败。Hub 1414 pass / 3 skip，Web 3249 pass，Shared 323 pass，Relay 118 pass；Hub 专项 22 pass / 119 断言，包含 fetch capability/namespace/拒绝任意目标 ref。HAPI 全包 types、改动后 CLI types、root typecheck 通过；fixtures 无差异。初次模块 LFS 检出失败促成新库 filters 修正，上述最终记录覆盖修正后代码。
- 实际验证：固定干净 HAPI pin 构建 linux-x64 配套 CLI 后执行 `bun run test:result-fetch`，`.dev-smoke/repository-result-fetch-I9yrha/evidence.json` success、cleanupErrors=[]；两轮成果均取回，真实 HTTP 丢响应共 3 次（导出 1、取回 2），Runner 重启返回同一成功回执且不要求下载临时文件继续存在。执行机停机且 Git 存储隐藏、源分支删除、原主库旧 LFS/模块对象移走后，从中心恢复两轮及旧/新实体，原父状态逐字节不变且拒绝 hook 未执行。最后明确 merge、原生 submodule 初始化和 LFS checkout 成功，执行端及模块上游均不可用，零 native sessions。同机多进程不作为物理跨机证据。
- 配套：HAPI 通用 fetch 与契约独立提交，root 更新 revision；复用 T1 实际脚本的 --fetch 分支，不增加第二套环境脚手架。中心结果清单和 Runweft 业务取回入口仍由 T3 完成。
- Commit：HAPI `remote-result-delivery T2: fetch verified results into the original repository`；Runweft `remote-result-delivery T2: verify original-repository recovery and explicit merge`

## T3 中心代码清单、交付与取回入口

- 结果：提取 RepositoryTransfers 和 SnapshotPublisher，基线/成果共用回执对账、100 项批次、capture/deliver、配额检查和候选释放。state v6 只新增代码清单/取回表，交付操作归原 round，请求沿原事务指纹。TaskResults 依据真实 HAPI 封存事实发布不可变清单，完整 HEAD/模块 bundle/LFS 复用，逐轮直接 pin 初始基线与成果文件的去重集合；无 result consumer 或原表改写。CLI result show/fetch/retry 与 MCP fetch_result/retry_result 接入，code_revision 使用既有 wait。取回固定轮次、原主库身份和操作 ID，本机成果直接展示原 ref；MCP 返回有界操作摘要。远端 spawn 仍按计划关闭，正式 finishing 接入留在 T4。
- 聚焦：6 项结果测试覆盖 100+ 文件、丢上传回执、配额/部分失败重试、封存不匹配拒绝、已停止 finishing 捕获失败的显式 retry、原 HEAD 无变化且目标离线的基线复用、取回待发布/固定轮次/离线与丢响应、code_revision、原 Git facts 不变。v5→v6 对 14 张原表逐行比较，包括机器/runtime、任务/输入/session/请求、文件意图/版本与基线/import/consumer/LFS/诊断记录，全部保留；consumer.importId 保持 NOT NULL。
- 回归：公共 helper 提取后立即通过 C9 11 项聚焦与实际诊断。`.dev-smoke/workspace-preparation-XJz8Ae/evidence.json` 验证传输层提取；进一步共用发布后 `.dev-smoke/workspace-preparation-ZTA1nW/evidence.json` 验证 schema v6、103 文件批次、重启恢复、源端离线、消费者及跨快照 LFS pin、真实缓存释放。两次均 success、cleanupErrors=[]。root typecheck 与全量 `bun test ./test` 146 pass / 0 fail；第一次新版本断言遗漏已修正。最终查询 next/通知游标/人类可读用量显示通过 22 项聚焦、typecheck 与配套编译，另存于 `.dev-smoke/c10-t3-final-*.log`。
- 实际成果：复用 T1/T2 环境脚手架的 `bun run test:task-results`，无模型实际 HAPI prepare/finalize 事实进入已结束 fixture 记录，编译 Hub 协调器随后完成两轮发布。`.dev-smoke/task-result-delivery-OBwjjj/evidence.json` success、cleanupErrors=[]；详细代码清单与取回回执在同目录 task-results.json。第二轮 HEAD 不变，零新增上传；模块 bundle 和 LFS 正确复用，初始旧 LFS 仍有本轮 recovery pin。目标 Runner 停止且 Git 存储移走，中心重启后，公开 CLI 与 MCP handler 均完成固定轮次取回；原分支删除、parent index/config/脏文件不变，明确 merge/LFS checkout 恢复代码及二进制，零 native sessions。这里的 MCP 使用无模型宿主身份 fixture，完整原生 MCP 委派矩阵留在 T6；不冒称物理跨机。
- 配套：HAPI 无新增改动，继续 T2 固定 revision；root linux-x64 配套构建完成。四平台候选更新和实际 npm 安装按 Plan 留在 T6。
- Commit：`remote-result-delivery T3: publish and recover task code through CLI and MCP`

## T4 远端 worktree 委派接入

- 结果：正式 CLI/MCP 开放远端 worktree，显式 base 在发起机固定；本机默认 HEAD 及原请求指纹兼容。environment 保存 origin/consumer/snapshot 与目标 source，按任务身份复用消费者，诊断与任务共享基线锁，服务先关闭任务再关闭基线。自动准备后进入原有输入/工作区/原生生命周期，收尾先封存、发布代码与附件，再形成完成通知；代码捕获失败可直接 retry，不改写 sealed facts。两轮沿原环境和 session 续接；T5 前明确拒绝远端删除。
- 聚焦与回归：root 全量 `bun test ./test` 151 pass / 0 fail、3320 断言；随后新增恢复与兼容案例，相关 workspaces/remote 聚焦 32 pass / 0 fail，最终 remote 7 pass / 0 fail、204 断言。覆盖源分支移动、上传丢响应、首次 import 失败零模型、捕获失败阻止排队下一轮、consumer 插入后崩溃恢复、同请求缺 base 拒绝、未知启动/停止不重发。typecheck、linux-x64 配套 build、diff 检查通过；HAPI 未新增改动。
- 真实原生：`bun run test:remote-tasks` 的 `.dev-smoke/remote-tasks-native-DGZxg9/evidence.json` success、cleanupErrors=[]。公开 CLI 驱动 Codex/Claude Code 各两轮，自动基线与新附件、工程指令/skill、其他 MCP、Runweft 工具禁用及 Claude 内置 Agent 保留均有记录；每种 runtime 复用原 session，四次执行进程均停止。分别注入 index lock、签名、hook、index lock 四次 Git 收尾失败，修复后只重试收尾；代码/输出/LFS 发布完成，目标 Runner 停止后公开 fetch 与显式 merge 恢复两份最终成果，原 index/config 保持不变。
- 实际回归：C9 `.dev-smoke/workspace-preparation-z1PqFB/evidence.json` success、cleanupErrors=[]。最终 T3 回归 `.dev-smoke/task-result-delivery-9xFdGR/evidence.json` 同样成功，中心重启、执行端目录离线、两轮清单复用、CLI/MCP handler 取回与显式合入均通过，零 native sessions。正式远端启用后，插入无模型 fixture 改为停服期间操作；首次回归发现 Hub ready 早于 Runner RPC 注册，脚本补上查询既有回执的就绪检查，未重发未知写操作。
- 边界：真实原生和故障测试均为同机不同 Runner 身份/数据根，不作为物理跨机验收。两宿主 MCP 完整矩阵、四平台候选及 npm 实装仍在 T6；成果释放与目标缓存联合清理在 T5。
- Commit：`remote-result-delivery T4: automate remote worktree delegation and recovery`
