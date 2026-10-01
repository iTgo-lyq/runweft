# 模块瘦身执行记录

## 方案与只读评审

执行者：实施 subagent `/root/slimming_implementation`，主 agent 内部复核/验收/提交。指定工作区 codex/module-slimming；本阶段仅Change文档与README入口，无产品/测试/脚本/Specs改动，无commit。

iclaude review session：`6870f51d-a7d7-4cfa-b49d-a2a96e69a693`。工具限制Read/Glob/Grep、plan权限、禁MCP/skill/写命令与委派。首次CLI MCP参数格式错误在调用前退出，修正后进入同session。读取方案及关键代码后长时间无输出，SIGINT确认退出，再同session禁工具要求收束，正常返回；不是quota耗尽，不用fallback。临时原结果 `.dev-smoke/module-slimming-review/conclusion.json`。

旧Plan结论可实施，B1完整gateway重启、B2全部package test:*映射已采纳；MCP零读取断言改当前无写入、schema对齐和按符号定位采纳。旧行种子/旧库保护建议被后续用户明确撤销，不采纳。S12不允许CI降级，若现有根测试不能等价替代则排除；U02仅DAG不改workflow。用户新增“无新旧数据迁移/兼容或旧数据清理”后，旧结论仅历史参考。

已新增data-format-research及修订Technical/Plan：唯一schema19当前建库，旧18/未知拒绝不写/不删，不定义旧登记表；T14在T9旧消费者退役后实施；移除data reset和历史smoke-upgrade脚本。config当前省略版本默认、当前optional/业务版本/原生resume/重试不属于旧数据兼容。修订Plan已在同review session补问，只读限制四个Change文件；结果已收束：新Plan可实施，T1可下发。B1格式相关删除集中T14、迁移旧版本拒绝测试到openState已采纳；B2建库/readonly WAL副作用须专用实验后确定，加入T14前置及严格不变口径；B3明确文件/记录错误码与隔离已入Plan。补充索引核验、原JSONversion断言、同候选schema19重启与schema18拒绝场景采纳。旧Plan建议保旧行不采纳。修订原结果 `.dev-smoke/module-slimming-review/revised-conclusion.json`。

本阶段实际检查：文档diff检查；代码/调用静态调查。没有宣称新的根测试/build/smoke通过；主agent先前基线检查仅为修改前证据。

主 agent 已复核修订方案、Plan及两次评审原结果，接受T1实施。格式切换集中T14，先以定向实验决定最小无写拒绝实现；不把评审建议扩展为通用格式兼容或迁移框架。文档确认提交：`module-slimming-audit: record reviewed implementation plan`。

## T1 中心 fixture 脱离旧服务

- 范围：新增native-fixture/task-native-fixture，搬出现有原生HTTP fake、JWT、机器探测、session/receipt/message queue/fault hooks；旧resourceFixture/taskFixture复用fake，业务接线仍留供T2–T4迁移。Hub delegation直接组装createDelegationGateway，未创建旧handler/旧协调器/旧资源登记；Hub resources保持原Resource/ConfigurationGateway，只移出inspection旧依赖并整理清理。共享until搬到helpers，Hub测试仅修改相关import。
- 重启：hubDelegationFixture.restart关闭/重建完整gateway，保持同statePath和native实例；gateway/url为动态getter，token/request/post使用当前实例。新增hub-delegation测试对Codex/Claude均验证丢spawn/send回执、已知结果收尾及unknown input跨完整网关重启不重放，native sessions/receipts/machineConnections保留；旧服务器listening=false且新URL实际HTTP可用，不断言随机端口必变化。
- 清理：fixture-cleanup只负责各fixture自己的逆序资源列表，尝试全部后聚合失败；native/resource/task/中心fixture构造失败立即回收已取得资源。setupHubResources同步构造分别登记DB关闭，不让一次关闭失败跳过其他DB。新增fixture-cleanup测试注入关闭故障，真实HTTP/DB仍关闭、root删除且构造/清理失败可见；native JWT构造BigInt序列化失败后新root立即删除，独跑先创建根目录。
- 实际验证：最终bun run typecheck退出0；bun test明确./test路径运行fixture-cleanup、hub-delegation/native/consumers/console/resources/resource-dispatch/agent-resolution/agents/repositories/resource-cli与旧tasks/resources/rounds/files/outputs/results/tasks-mcp/workspaces/remote/remote-tasks，共159 pass、0 fail、4082 expect，21文件36.19秒。原始日志`.dev-smoke/module-slimming-review/t1-tests.log`。此前21项Hub/compiled测试及65项旧fixture/remote关联测试亦通过；最终21文件包含这些保障。
- 修复过程：初次typecheck发现旧taskFixture误引用包装后的cwd，改回fake.cwd；首次中心请求因native root:NS token映射报inventory失败，修正native假服务对冒号namespace的原生认证解析后通过；新增重启测试初次误写finish=finished，改为现行complete后通过。未将失败结果视为通过。
- 边界/遗留：无产品代码、HAPI、schema、版本、lock、宿主配置、Specs修改；未提前删有效旧测试或做T2/T14，未执行build/真实模型/browser/远端，本任务仅fixture接线。实现者交回时未提交；主 agent 的验收结果如下。

- 主 agent 验收：已逐项检查 native fake 提取、现行 gateway HTTP 接线、完整重启与清理归属。要求并已修正依赖随机端口变化的断言与单测独跑目录前置；没有删除原有效测试。独立执行 `bun run test`：268 pass、0 fail、5315 expect、44文件、52.87秒，日志 `.dev-smoke/slimming-acceptance/t1-root-test.log`；`git diff --check` 通过，产品/脚本/依赖无差异。本项验收通过。
- Commit：`module-slimming-audit T1: detach central fixtures from legacy services`

## T2 任务接受、轮次与查询保障迁中心

- 范围：tasks、task-rounds、tasks-overview、tasks-mcp 脱离旧 task/resource fixture，使用当前完整中心 gateway、用户身份/space、中央 Agent UUID 与机器连接记录；HTTP 经过真实授权 bridge，MCP 使用实际 SDK transport 和当前 HubTaskClient。重启全部调用 T1 完整 restart；未新增旧 API 翻译或模拟 Hub 授权。
- 替代关系：
  - tasks：并发接受/固定 requestId、递归身份在输入前持久化、报告分页、lost spawn/send、unknown不重放、取消wait不停止、固定目标错误、持久spawn intent恢复、known完成/uncertain输入跨重启原断言保留。旧“丢接受响应后移除Agent YAML”改为HTTP代理丢当前spawn响应后撤回中央Agent，再用同requestId查询原回执；仍只spawn一次。旧namespace隔离改为other owner×same space和other owner×other space。schema1资源迁移专属用例仍直接ResourceStore/TaskStore，留T14。
  - task-rounds：两runtime队列/stop后续轮、resume新identity及丢响应、missing才重建业务上下文、unknown不重试、取消/steer/审批/原生报告界限/stop后读取失败全部保留。原wrong-machine场景现行bridge先拒绝，改为专门`resume into an unclaimed machine`断言delegation_native_mismatch、needs_attention、not_started；完整restart后resume/spawn/send各保持1，stop只计前一轮正常完成的1次，不认领/不谎称停止外来对象。另wrong-cwd场景仍验证execution_target_mismatch、准确停止已认领session、不发新输入。
  - overview：通过真实中央resolve取得当前Hub snapshot再由当前store播种（非YAML快照），完整gateway用60秒poll且启动时空库，查询均真实HTTP。原认证/隔离/过滤/分页/unknown/ absent/成果存储与release/内容脱敏/轮次选择/库存故障/只读/千任务100项页全部保留。other owner same space的数据仍不可见。namespace注入现行access层错误为invalid_native_request；其余坏筛选仍invalid_task_request。PRAGMA data_version及store内容不变验证保留。
  - MCP：两host发现/幂等/分页/父任务隔离，准确审批/取消/递归抑制，cancel和disconnect不停止shared/worktree执行，explicit Git基线/repair/续轮均保留。真实小Git repo在专用fixture建立并显式绑定当前Hub repository；native workspace fake返回实际请求机器ID，未放宽产品源码/基线核验。旧AgentClient原生auth取消改为当前HubAgentClient健康能力+auth取消，仍无资源probe。没有删除或合并有效测试。
- 实际契约缺口与窄修复：迁入overview后原6000ms库存超时测试失败。旧tasks/coordinator有3秒库存截止，当前hub/delegation/api未设；真实RequestLease无deadline，native fetch收到显式signal会覆盖默认timeout（不是30秒lease）。主agent授权T2补回：resources.machines内部可选signal默认原lease.signal，overview组合请求signal与3000ms timeout，保留成功/失败后的lease.check，无重试。正式CI新增“库存在途撤成员→401且无items”，不将权限失效降级为成功读。主agent独立token旋转HTTP证据为`.dev-smoke/slimming-acceptance/overview-revocation.test.ts/.log`，1 pass，不冒充实施者运行或重复加入CI。
- 实施者实际命令：`bun run typecheck`通过；`bun test ./test/tasks.test.ts ./test/task-rounds.test.ts ./test/tasks-overview.test.ts ./test/tasks-mcp.test.ts ./test/hub-delegation.test.ts ./test/hub-resources.test.ts ./test/hub-access.test.ts ./test/hub-consumers.test.ts`：67 pass/0 fail/1621 assertions，8文件（含compiled CLI/MCP consumers）；`bun test ./test/task-workspaces.test.ts ./test/task-files.test.ts ./test/task-outputs.test.ts ./test/artifact-mcp.test.ts`：39 pass/0 fail/924 assertions，4文件，旧fixture仍独立工作。`git diff --check`通过。临时重复的token旋转CI用例试跑后按主agent意见移除；最终正式测试计数按前述67次结果，不记录它为交付保障。
- 边界：只有获授权overview截止时间是产品变更；未改schema/package版本/lock/HAPI/用户home/Specs，未推进T3/T14；未提交、未改任务完成状态。未运行根全集/build/browser/真实模型/远端；主agent继续独立review/验收。

- 主 agent 验收：逐项复核四组测试差异、当前中心调用链、错误机器/目录两种不同边界与旧保障替代；独立 token 旋转HTTP检查1 pass。独立 `bun run test` 270 pass、0 fail、5245 expect、44文件、54.70秒；`bun run build`通过，日志在 `.dev-smoke/slimming-acceptance/t2-root-test.log` 与 `t2-root-build.log`。Review另将405测试中仅为抛错而建的IIFE改为直接响应状态断言，定向重跑该用例1 pass/0 fail/23 expect；`git diff --check`通过。没有扩展权限或降低超时/边界断言，本项验收通过。
- Commit：`module-slimming-audit T2: migrate task guarantees to central gateway`
