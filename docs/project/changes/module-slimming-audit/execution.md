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

## T3 工作区与输入输出保障迁中心

- 范围：task-workspaces、task-files、task-outputs、artifact-mcp 全部接当前完整中心gateway。新增hubWorkspaceFixture仅建立专用小Git仓库、真实observeRepository及当前中心checkout绑定，复用T1网关而不造旧API翻译/授权mock；共享目录仍提交当前中心选择器。保留动态gateway/url，files/outputs harness用Object.assign保留getter，文件HTTP每次取当前url，完整restart后不会捕获旧实例。
- 保障替代：
  - workspaces：原15用例全部保留，准备门禁/故障、不启动证明、固定base、seal后续轮、明确retry_finish、取消准备、启动拒绝、stop未知、删除幂等/续轮互斥、ignored删除失败及两runtime场景仍经当前HTTP执行；lost seal/remove恢复改完整gateway.restart，仍各操作只发一次且无模型重放。原“CLI任务改MCP parent删除”现行先拒绝task_parent_mismatch，保留该断言并另接受真实MCP父任务验证workspace_remove_cli_only。当前Git共享任务接受会只读resolve，删除拒绝不产生任何prepare/finalize/remove；明确断言仅两次接受各一次resolve。unversioned专属用例继续通过直接数据库去version和当前store验证，留T14统一移除。
  - files：原7用例保留；HAPI ArtifactService/Hono继续存字节，用户ArtifactClient通过真实Hub鉴权及NativeFiles映射；输入名/摘要冻结、pins/unknown/download重查、worktree拷贝和中间副本release、pin响应丢失及未接受引用回收、unpublished/重复/父任务/steer拒绝、仅本人轮次pins释放均保留。未接受引用启动回收改完整restart及等待真实reconcile，不裸建协调器；reserved输入通过当前用户reserve建立授权映射。
  - outputs：原15用例保留；fake Runner以登记machineConnection.token通过真实Hub/auth、/api/artifacts reserve/PUT发布，HAPI ArtifactService只存字节，不直接用machine RPC namespace把对象塞入runweft空间、不手写grants。保留stop及seal前不capture、丢capture/deliver/publish只重查、固定失败候选retry、后续collect版本、两MCP host原生call幂等/父隔离、未准备/不安全/活动轮拒绝、启动失败及原生失败结论、队列门禁、release预览/外部恢复pins/unknown不可释放、release恢复后续轮和并发输入cleanup warning。collect/release重启全部完整gateway.restart，查询和续轮走HTTP。原cleanup的releaseOutputs回调模拟改真实gateway.delegation.taskClient+TaskOutputs：用原delivery请求恢复实际授权grant，再确认cleanup后机器read/write均撤回，失败项不冒充available。
  - artifact-mcp：原2用例保留；删除手工身份token/JWT/假Hub auth路由，改完整中心身份及真实NativeFiles，byte routes仍HAPI ArtifactService。两host请求幂等、读ID/request、路径/跨目录/符号链接限制、字节不进上下文、上传丢响应回收和取消下载无目标/partial文件全部通过。
- fixture清理：hubWorkspaceFixture与三套ArtifactService harness沿用T1 fixtureCleanup。新根创建后立即登记rm、DB创建后立即登记close；MCP server/client分别登记且在connect前完成，任何构造失败调用failed即时关闭。四文件afterEach通过同一cleanup owner尝试全部余项，不在首错停下；不新增产品工厂注入点或新清理框架。
- 必要窄修：本机省略baseRef后同requestId显式HEAD真实HTTP返回409。根因是TaskStore.semantic补默认后的JSON键序：Hub的taskIntent绕过旧AcceptSchema重排，省略时baseRef位于agentType/hubRequest之后，显式时在前；contentVersion直接JSON.stringify得到不同hash。专用复现`.dev-smoke/slimming-acceptance/head-fingerprint.ts`。经主agent确认，semantic先取出baseRef再放固定末位置，保持baseRef ?? HEAD；原本机等价断言保留，新增两种lookup结果等价。远端缺显式base仍拒绝（本次旧remote-tasks实际回归通过），不改通用contentVersion/validateWorkspaceTarget、不加旧hash fallback/重算/历史迁移。
- 实施者最终命令：`bun run typecheck`通过；`bun test ./test/task-workspaces.test.ts ./test/task-files.test.ts ./test/task-outputs.test.ts ./test/artifact-mcp.test.ts ./test/hub-delegation-native.test.ts ./test/hub-delegation.test.ts ./test/fixture-cleanup.test.ts ./test/remote.test.ts ./test/remote-tasks.test.ts ./test/task-results.test.ts`：83 pass/0 fail/1996 assertions，10文件；其中旧remote/task-results消费者、120+ batching/LFS、两runtime及remote显式HEAD→省略拒绝仍执行。另在指纹修复前跑过`bun test ./test/hub-delegation-native.test.ts ./test/hub-delegation.test.ts ./test/artifacts.test.ts ./test/remote.test.ts ./test/remote-tasks.test.ts ./test/task-results.test.ts ./test/resources.test.ts`：58 pass/0 fail/1465 assertions，7文件，旧resource fixture与附件CLI均正常。`git diff --check`通过。
- 边界：无有效测试删除/合并；除获授权的指纹键序修复无其他产品修改；schema仍18，未改HAPI/lock/package版本/用户凭据/Specs/AGENTS，未推进T4/T14。data-format-research的主agent调查保留未覆盖。未运行根全集/build/browser/真实模型/远端；未提交、未改完成状态，交主agent独立review/验收。
- 主 agent 验收：复核四组逐项替代、实际 Hub 文件绑定/机器授权、完整网关重启、清理所有权及指纹根因；原有效测试均保留。独立 `bun run typecheck`、`bun run build` 通过；`bun run test` 为270 pass、0 fail、5167 expect、44文件、55.30秒，原始日志 `.dev-smoke/slimming-acceptance/t3-root-{typecheck,test,build}.log`。`git diff --check`通过，本项验收通过；本结果不代表最终schema19、浏览器或真实模型验收。
- Commit：`module-slimming-audit T3: migrate workspace and artifact guarantees to Hub`

## T4 远端与代码成果保障迁中心

- 范围：remote、remote-tasks、task-results 的现行场景全部使用当前中央 Agent、owner×space、完整 gateway、真实 HTTP 与授权 bridge。remoteNativeFixture 只提取原生 Git/transfer/artifact metadata fake；Runner 使用登记机器凭据经真实 Hub auth、reserve、PUT 建立文件映射，没有手写 grant 或旧 API 翻译。所有重启均调用 T1 完整 restart，动态 getter 保留；remote fixture 用 T1 cleanup 所有权与构造失败回收。
- 保障替代：
  - remote 原11用例全部保留：100+文件分批、快照/LFS复用、固定请求/基线、丢发布回执、离线目标、完整重启、限制/配额、失败prepare、部分发布、跨快照pins、dirty/ignored/cache错误、丢remove/unpin与显式留存。其他owner读取/释放仍404；child递归拒绝改为通过当前HTTP接受、运行并完成的有效任务及真实session关联，拒绝前后不新增原生请求，去除损坏空JSON种子。
  - remote-tasks 原11用例（含两runtime参数化）全部保留：自动准备、移动分支不改变基线、两轮resume、成果先发布再完成、shared/缺base/缺能力不接受不dispatch、失败import/capture及队列门禁、发布/留存release预览、释放轮fetch拒绝与其他轮available、incomplete显式discard、definitely-failed discard恢复队列但unknown不得释放、已保存partial release跨完整restart、不重复dispatch/repin、consumer先提交后恢复关联、explicit HEAD后省略拒绝、丢spawn和unknown stop不得重放/越过seal。changed默认false保持原无改动复用场景，显式true仅修改首次finalize指定environment/round。pin按非空available manifest的实际baseline/output对象逐项确认未释放轮引用保留，同时全refs验证已释放轮引用消失；保留共享consumer/最终cache释放保障。错误parent仍task_parent_mismatch，另真实MCP任务验证result_release_cli_only。当前preflight可只读resolve，明确断言除此无操作且任务/模型接受数为零。
  - task-results 原6用例全部保留：103文件、LFS重用、丢delivery仅查回执、语义mismatch不发布、quota retry固定bytes/Git事实、冻结fetch轮次、离线/lost fetch不重复、未改动HEAD直接baselinepins、明确失败capture/retry。领域引擎仍定向推进实际TaskResults，使用当前store及taskClient；成果wait验证前完整restart恢复运行协调器，再经HTTP读取修订。v5专属用例仅暂留到T14：停止当前coordinator/preparations两个扫描器后SQL合成旧登记两表、DROP历史结构及直接openState/Store验证；所有临时DB用finally关闭，无新增旧ResourceStore消费者。
- 有效旧资源/Agent保障去向（旧测试本项不删除，T8/T9再退役）：
  - resources「auth precedes storage」→hub-access鉴权与hub-resources「HTTP…strict bodies and credential kinds stay separate」；旧caller JWT/namespace透传由当前identity/machine分离授权替代，不恢复旧认证模式。
  - resources「discovery is read-only…identity」→hub-resources「enrollment…replay safe,durable」及「resource HTTP handles owner lifecycle…rename」；「offline…never another target」→「shared and governance DTOs…offline observations」与hub-agent-resolution「runtime overrides…failed chosen layers never fall through」。
  - resources「fresh inspection…actual command/unknown version」→本项新增hub-delegation「current resource preflight checks launcher facts…」：command_missing、invalid_configuration、unknown/timeout版本可用、probe缺项失败、spawn/resume/send均零；「one-machine failures」→hub-resources「one probe per machine preserves independent failures…」。
  - resources 两条in-flight cancellation→hub-resources「revocation during tool probing rejects resolution and stale registration」与hub-agent-resolution「asynchronous probe rechecks…membership」；「client local routing…no authority copy」→hub-resource-cli/consumers现行Hub配置测试；旧local gateway路由本身无现行产品用途，不复刻。
  - resources「persisted schema…IDs」→hub-resources前两条enrollment/credential持久性与并行CAS；旧格式迁移/新版本拒绝细节统一留T14处理；「structured/native errors…without mutation replay」→hub-resources「resource HTTP…strict bodies」的400/403/413与「shared and governance DTOs…」错误脱敏、hub-resource-dispatch「actual outgoing native RPC rechecks…」零dispatch。当前不允许恢复旧原生私密错误原文透传。
  - agents「read side effect free…content snapshots」→hub-agent-resolution「resolution snapshots retain content…no native execution」；「selected bad never fallback」→「runtime overrides…failed chosen layers never fall through」。旧YAML project override/读文件异常、工作树definitions、非Git home探测与dotfile symlink属于已退出产品的文件Agent发现，不重建等价API；当前仓库身份/绑定隔离由hub-repositories现行测试保障。
  - agent-targets「native defaults/flavor mapping」→hub-agent-resolution「shared Agent…flavor checked」Claude model/effort映射，以及本项在「resolution snapshots…」增加Codex默认与disabledMcpServers精确断言；Codex model/high的modelReasoningEffort与permissionMode缺省沿用「shared Agent…flavor checked」已有断言；旧文件snapshot无写client表不再宣称等价，当前resolution明确零native执行/零任务。
  - agent-targets「bindings precedence…sources/namespaces」→hub-agent-resolution selection/override优先级与权限交集；「offline/flavor/missing/local never fallback」→同文件flavor checked、runtime overrides及hub-resources offline用例；「batched discovery/errors/freshness」→hub-resources one-probe和hub-agent-resolution asynchronous recheck。旧YAML bindings专属表/文件保持测试留到退役，不新增消费者。
- 证据边界：本项真实Git仅为专用小仓库的当前observation与中心绑定。原生Git导出/导入/seal、LFS、transfer receipts和artifact metadata/placeholder PUT字节为fake，不是实际Git bundle、哈希或跨机字节实测；真实Hub授权/文件映射/HTTP与SQL持久恢复确实执行。旧fake的refs/rounds成果引用被当前bridge schema拒绝，已按固定HAPI真实refs/hapi/workspaces/{environmentId}/rounds/{roundId}修正，无产品修改。
- 验证：`bun test ./test/remote.test.ts ./test/remote-tasks.test.ts ./test/task-results.test.ts` 28 pass/0 fail；15文件关联组合（上述三组、hub-delegation/native、hub-agent-resolution、hub-resources/resource-dispatch、旧resources/agents/agent-targets、T3 workspaces/files/outputs/artifact-mcp）120 pass/0 fail，日志 `.dev-smoke/slimming-acceptance/t4-related.log`。用例名逐项对照HEAD三文件完全一致；原expect数103/97/58，迁后103/105/58（最终v5资源关闭不改变断言）。最终 `bun run typecheck`通过；完整task-results 6 pass/0 fail（v5关闭方式修订后重跑）。
- 遗留：主agent独立根验收/提交待进行；未执行真实原生模型、真实跨机器或真实Gitbundle字节验收。本项不改变schema18、产品源码、Specs、HAPI/依赖/版本，也不退役旧fixture及旧资源/Agent模块。
- 主 agent 验收：逐项检查原用例名称、故障默认值、有效断言和真实授权链；review发现的误删用例/断言、changed默认值偏移、对全部sealed结果重复修改均已恢复，旧v5专属合成前停两个扫描器并用finally关DB。独立 `bun run typecheck`通过；`bun run test`为271 pass、0 fail、5073 expect、44文件、58.00秒，日志 `.dev-smoke/slimming-acceptance/t4-root-{typecheck,test}.log`。清理一条未使用import后定向task-results再跑6 pass、0 fail，日志`t4-results-review.log`；diff检查通过。产品源码与T3已通过构建的版本一致，本项未重复build。本项验收通过。
- Commit：`module-slimming-audit T4: migrate remote recovery guarantees to Hub`
