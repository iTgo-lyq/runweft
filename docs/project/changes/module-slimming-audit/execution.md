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

## T5 无模型 smoke 当前接线与清理

- 范围：新增 `smoke-coverage.md`，逐名记录 package 全部46个 `test:*` 的 argv、场景、依赖和后续任务。resources/agents 保留单 CLI positional、`RUNWEFT_SMOKE_ROOT`，通过 `installedBinaries` 使用该 CLI 配套 HAPI，直接调用导出的当前 Hub 场景；Hub 两入口继续保留 HAPI、CLI 双 positional 顺序，错误向入口传播。没有更改 package 脚本名。
- 保障替代：resources 原稳定 ID/版本/治理/撤权/重启/离线迁到现行登记机器和 owner×space；补真实 Runner command missing、invalid override、version probe failure 与恢复，重连以真实 discovery RPC 成功确认而不依赖45秒旧 presence。agents 复用中央配置/仓库 observation/选择器/授权交集/重启，补两 runtime model/effort 精确映射，以及无效身份、持久 config、definition 与输入错误；当前显式 Hub Agent 命令不读取本地 config，config 错误通过真实 `config show` 验证。历史 YAML/project override/token suffix 不重建。
- service/hub-service 只移除 reset 专属场景，保留 start/重复 start/stop/重启/foreground/独立权限/工作区与未交付现场，fresh enrollment 使用独立新 home。无 package 入口的旧 `smoke-upgrade.ts` 删除；服务版本不一致保障改由实际 compiled 服务加窄 health 广告版本代理验证 status.restartRequired 与 doctor 失败，不使用旧 binary 或历史数据。产品 reset/state 未改，旧18拒绝/当前19重启仍归T14。
- MCP：窄协议 probe 以当前 compiled `hub ... mcp serve` 和内存身份，验证17工具、stdout JSON-RPC、请求取消与 stdin EOF 的真实 HTTP abort、无写请求及未创建 home。它的 HTTP endpoint 仅用于控制在途认证传输，未模拟授权中枢。新增 `--protocol-only` 在模型凭据检查前分支；默认 MCP 流程仍调用 probe 并保留模型矩阵待T6迁移。专用 native 配置安装/检查/卸载由现有真实 installation helper 验证，不改用户配置。
- 清理：窄 lifecycle helper 登记真实 HAPI 进程，构造失败即停止并报告；逆序尽力清理，单个 socket/abort/DB/browser/进程失败不会跳过其余。秘密副本只在所有相关进程确认退出后移除，恢复现场/evidence 留存。新增两个实际进程测试覆盖 `/bin/false` 构造失败、SIGTERM 后退出7拒绝、活进程秘密保留、失败后继续其余清理。EOF failure cleanup 与 service foreground fallback 均等待实际退出。
- HAPI 关闭限制：仅资源脚本在线撤凭据窗口允许固定 HAPI 收到 SIGTERM 后 proper cleanup 卡在 updateRunnerState、1秒 fallback exit1。按本次 PID 专用日志确认三个标记、无FATAL、没有 cleanup completed、PID消失，evidence 明示并非优雅退出；随后以新凭据恢复 Runner。固定源码与私有日志已由主agent核对；其他 stop 仍严格拒绝非预期退出，没有修改 HAPI。
- realtime 原脚本把 B 的 session 放在 A 机器却预期 B 交互 terminal 成功，原HEAD复现失败；当前 `authorizeTerminal` 与 execution/access Specs 要求 session 写和 machine 写。修为 A+A session 双向交互成功、B+B session 只读 agent 输出成功且 terminal/input 拒绝、A 机器 owner 对 B session 仍拒绝；B 的 viewer 留到 token rotation/空间移除撤权，未放宽产品权限。变量明确为 ownerViewer/memberViewer/rejoinedViewer。
- 实际自检：`bun run typecheck` exit0；`bun test ./test/smoke-lifecycle.test.ts` 2 pass/0 fail/12 expect；`bun run test:mcp --protocol-only`、`bun run test:resources`、`bun run test:agents`、`bun run test:service`、`bun run test:hub-service`、`bun run test:hub-access`、`bun run test:hub-realtime` 均 exit0。另 `bun run test:hub-configuration dist/hapi dist/runweft`、`RUNWEFT_SMOKE_ROOT=.dev-smoke/slimming-acceptance/custom-root bun run test:hub-resources dist/hapi dist/runweft` exit0，验证直接双 argv 与 root override；`RUNWEFT_SMOKE_CHROMIUM=/home/tiger/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell bun run test:hub-connect` 真实 Playwright 5组通过。日志 `.dev-smoke/slimming-acceptance/t5-*.log` 与各脚本 Evidence 根保存实际场景证据；早期失败日志保留，以上指最终修正后结果。
- 边界：上述 access/resources/configuration/realtime 是实际 HAPI+Runner 与 Runweft 组合网关层；service/hub-service/connect 与 MCP 是 compiled CLI 层。无真实模型执行、无 Git 字节/成果留存验收，不宣称整个默认 test:mcp 或 hub-delegation-native 执行了两 runtime 模型。T6/T7/T14其他保障未提前处理；未运行根全集/build、不认领主agent独立检查或 SQLite 实验。没有产品代码/Specs/依赖/HAPI/package版本/workflow/用户 home 修改，未提交、未标任务完成。

- 最终静态复核：机器 credentialFile 在 enroll 返回时即登记，读取/associate 前失败也清理；保留 macOS Codex.app 内置路径的旧有效前置判断，仅 HAPI 负责实际发现/启动。Linux实测通过，macOS未实测。
- 最终逐断言补齐：resources独立验证机器/runtime改名、机器unregister不连带取消两runtime登记但resolve明确machine_unregistered、同machine恢复、runtime unregister列表/详情registered=false且不可用、同ID/name恢复；真实discovery后register前列表仍空。configuration验证runtime取消导致Agent resolve runtime_unregistered，恢复同ID/name；target.checkedAt因真实重新探测允许非下降，其余完整resolution（含resolvedVersion）相等。纯Hub客户端home执行Agent list/resolve后无server/runweft/state.sqlite/client.sqlite；机器enroll home的正式本机协调client.sqlite不属于该断言对象。未改产品。
- 补齐后实跑：`bun run test:resources` 与 `bun run test:agents` 最终均exit0，分别证据根 `.dev-smoke/hub-resources-b6POXl`、最终configuration Evidence根及日志 `t5-{resources,agents}-lifecycle-final.log`；仅重跑这两家族，其他主agent已完成六组未重复。配置恢复快照、纯客户端无库检查均实际通过；最后typecheck与diff检查通过。
- 最后connect清理返修：仅把serviceStopped确认后的三个秘密文件删除改为已有closeSmoke逐项callback，删除首错不跳过余项、聚合报告；其他脚本冻结。`bun run typecheck`及带固定RUNWEFT_SMOKE_CHROMIUM的`bun run test:hub-connect`均exit0，真实Playwright五组通过，证据 `.dev-smoke/hub-connect-4nsq4m/evidence.json`，日志`t5-connect-cleanup{,-typecheck}.log`；diff检查通过。未开始T6。

- 主 agent 验收：逐项复核原有效断言、当前授权边界与全部46个test:*映射；退回补齐登记生命周期与清理失败续行后通过。独立typecheck、smoke-lifecycle 2 pass/0 fail/12 expect；真实HAPI资源10组、配置9组、服务6组、access12组、realtime10组、Playwright connect5组均成功且无cleanupErrors。资源/配置新增断言后重新独立实跑，日志`t5-root-{resources,configuration}-final.log`，清理小修后实施者再次跑connect5组，主agent核对源码与原证据。候选/原始证据汇总`.dev-smoke/slimming-acceptance/t5-root-summary.json`。产品未变，沿用T3构建候选；本项未重复根全集/build、未执行模型或物理远端。
- Commit：`module-slimming-audit T5: consolidate current Hub smoke and cleanup`

## T6 批次A：无模型文件/Git/诊断

- 九入口迁当前身份/空间、机器登记、中央Agent及真实文件授权。artifacts/prune继续compiled服务与compiled CLI；outputs/inputs机器分支/repository-export/import为compiled CLI + current source delegation gateway +真实HAPI/Runner。低层fixture明确停止模型dispatcher后，用actual resolver/current TaskStore播种完整当前Task/Round.agent/终态，再复用delegation.taskClient的现行policy；没有公开机器RPC、空check、旧API翻译或真实任务从接受到模型完成的E2E声明。hub-delegation-native改为完整gateway、实际来源Runner/当前准备snapshot与taskClient；hub-delegation-preparation保留既有中央实际HTTP/跨owner准备。
- 逐保障：artifacts保留两client/server-policy、72MiB/hash、真实3byte断流同reservation恢复、慢流>10秒、引用/删除/tombstone、重启零Runner/session；root suffix隔离换真实other owner/space，root CLI文件路由拒绝，允许的machine grant读/撤回由hub-delegation-native实际publication/input场景保障。prune保留policy/usage、所有purpose pins、年龄、预览、分页、丢回复查原tombstone、quota/重启/零模型；旧doctor.artifacts DTO已不存在，改用真实artifact limits与当前paths/实际私有DB目录，不恢复旧诊断字段。
- outputs保留72MiB部分发布、固定capture候选、缺文件后显式collect、源文件删除后同delivery恢复、Hub/Runner重启、spool释放、停止Runner后的download/hash。inputs机器分支保留72MiB真实transfer/hash、完整Hub/Runner重启后固定回执、Unicode worktree输入、释放中间下载后仍保留工作树副本、seal/remove及零session。export/import保留实际bundle/module/LFS、私有NativeTransport上游HTTP丢回复、同operationId恢复、source/Git refs/index/config保护、source离线、独立目标Runner、损坏输入、固定import/prepare/finalize/remove、零session。
- 正常shutdown缺口与窄产品修复：workspace-preparation固定请求复现git_interrupted（错误停止了外部Runner），继而完整Hub正常close且Runner存活仍unknown/machine_offline。失败根gWwAUQ，日志t6a-workspace-preparation-final.log；当前sockets.close发送Socket.IO server DISCONNECT，固定HAPI只清RPC/keepalive不会自动重连。整体shutdown先置flag、关闭Engine.IO transport，撤权/旋转/孤立上游断联仍显式disconnect；不实现重连器/重试、不以模拟断网取代原故障窗口。新根测试正常transport关闭后自动连接、固定RPC不重放、fresh RPC成功、旋转io server disconnect/active=false、旧凭据新握手拒绝。
- workspace-preparation最终恢复完整高层：compiled CLI + compiled center serve/start/stop +真实两Runner。repository create/bind、Agent创建与诊断均走compiled当前命令；无低层领域种子。保留103文件/批≤100、dirty只取固定commit、同request重启、snapshot/import及第二commit LFS复用、source离线、dirty/ignored拒绝、offline unknown/pins、最后consumer删除cache、本机runtime诊断拒绝且零额外准备。schema断言引用当前STATE_SCHEMA_VERSION，不保留旧v6数字。停服后逐Runner最终status确认，秘密清理不能被center成功覆盖。
- 候选：build exit0；dist/runweft SHA256 `ffb8aec139d88fef6a2f0475f6993bcbf4890fb56480ec28dc4baf19dec1c5e9`，显式dist/hapi SHA256 `bdf706d7966ae4818b09029991a2bb03e70b10b0555763fc41430afd977b4fec`。日志`t6a-build.log`。所有默认双binary按原顺序使用；两个Hub专用入口的单参数仍是HAPI。早期candidate.entry=compiled实际指compiled CLI+source gateway、candidate.bun的process.version是Node兼容版本；已修正后续标签/Bun.version，未篡改原evidence。src模式标source CLI，不宣称compiled；本批实际输入为compiled机器分支。

自检最终命令均exit0，日志目录均为`.dev-smoke/slimming-acceptance/`，evidence均在下列根的`evidence.json`：

| 实际命令 | 日志 | Evidence根（.dev-smoke/） |
|---|---|---|
| bun run test:artifacts | t6a-artifacts-fixed.log | artifact-cli-frYRaC |
| bun run test:artifact-prune | t6a-artifact-prune-fixed.log | artifact-prune-Vk0ogK |
| bun run test:outputs | t6a-outputs-fixed.log | outputs-machine-JBzzMB |
| bun run test:inputs dist/runweft dist/hapi --machine-only | t6a-inputs-fixed.log | inputs-native-jeWnRq |
| bun run test:repository-export | t6a-repository-export-fixed.log | repository-export-zh2JkD |
| bun run test:repository-import | t6a-repository-import-fixed.log | repository-import-CqXpvz |
| bun run test:hub-delegation-native | t6a-hub-delegation-native-fixed.log | hub-delegation-native-RPLNkj |
| bun run test:hub-delegation-preparation | t6a-hub-delegation-preparation-fixed.log | hub-delegation-preparation-TVZd8Y |
| bun run test:workspace-preparation | t6a-workspace-preparation-compiled-final.log | workspace-preparation-Q0OLsX |

- 自检typecheck exit0；sockets/access/resource-dispatch/delegation-native根定向20 pass/0 fail/172 expect，日志`t6a-{typecheck,sockets-test}.log`；diff检查通过。主agent独立验收同候选九入口全部exit0、cleanupErrors=[]，根274 pass/0 fail/45文件与typecheck通过，证据`t6a-root-summary.json`；本实施记录不认领这些独立执行。
- 清理：本批无外部后续evidence consumer。确认所有进程退出后，成功root回收大文件/下载、spool/缓存/Git、DB与凭据/配置，只保留紧凑evidence/顶层日志；九最终现场已检查满足。失败保留DB/Git/固定receipt诊断，退出后清确切秘密路径，包括HAPI jwt-secret.json。早期本agent自检33个明确新建root的额外回收清单`t6a-owned-cleanup.json`，未扫描历史home/他人fixture、未清旧版本业务数据。
- 批次A不含模型验证。inputs默认分支待批次B按flavor固定实际runtime/Agent，重启后重新取得ExecutionClient，新的显式resume对应新当前Round，同一次unknown恢复保留固定ID；不能把machine-only成功当默认双runtime成功。其他任务/模型producer-consumer链、矩阵、T7/T14仍未推进；未改HAPI/依赖/版本/Specs，未提交、未标T6完成。主agent接受批次A后正式下发四家批次B。

- 主 agent 批次验收：逐项复核九入口的原有效断言、当前授权链、正常关闭与撤权的区别，以及成功/失败现场清理。独立执行九入口均 exit0：artifacts 6组、prune 3组、inputs机器分支2组、outputs 3组、export 2组、import 3组、native bridge 6组、中心准备5组、完整编译服务诊断6组；cleanupErrors 均空，成功目录仅留证据/日志。独立根全集274 pass/0 fail/5093 expect/45文件/57.65秒；Socket/access/dispatch 定向14 pass/0 fail，最终 typecheck 通过。使用上述 ffb8aec1 候选与固定 HAPI；原始日志为 `t6-root-*.log`，包含源码与候选摘要的独立汇总为 `.dev-smoke/slimming-acceptance/t6a-root-summary.json`。批次A通过，T6仍进行中，尚无模型验收或最终schema19结论。

## T6 批次B：execution/MCP/workspaces/inputs 默认模型

- 仅迁四入口和必要窄helper。execution/MCP保持高层compiled中心与compiled用户CLI，用公共HubClient.http的当前个人native intent/session边界；真实登记身份、空间、machine/runtime，未复活root token、公开机器RPC或旧init/YAML。local/hub两个MCP标签均为当前Hub的独立client+Runner home。workspaces/inputs由current完整gateway停止dispatcher后领域store/resolver播种、私有taskClient现行policy接线，真实HAPI/Git/bytes/双模型；不是Task E2E。当前Task/Round.agent/终态完整，不新增旧格式记录或迁移路径。
- 原断言逐项保留位置见smoke-coverage T6B。inputs的重启后ExecutionClient改为动态request/response，flavor对应当前Agent/runtime；每个新的显式独立resume采用TaskStore.append新Round，同一attempt未知回执仍保持原ID/原Round，不随机换轮隐藏unknown。actual nativeID/host PID写入evidence；machine-only仍零session、零模型。
- 专用model-homes仅复制必要native配置到实际使用的目录，原source hash验证不变；Codex override只改副本，RUNWEFT_SMOKE_CLAUDE映射实际launcher/observer。构造失败在helper内逐份回收；finally逐session尽力stop并采集known PID，确认模型host与Runner/HAPI均退出后删副本。局部modelShutdownConfirmed与proxy/日志等无关cleanupErrors分开，安全的秘密清理仍尝试，失败现场数据仅完全成功才回收。
- 自检32 pass/0 fail/278 expect/5文件：`bun test ./test/hub-access.test.ts ./test/hub-resource-dispatch.test.ts ./test/hub-delegation-native.test.ts ./test/mcp.test.ts ./test/mcp-install.test.ts`，日志`t6b-current-tests.log`；此前只实际匹配到一个文件的6 pass记录`t6b-focused.log`不冒充多文件验证。`bun run typecheck`与diff检查通过。没有B产品修改，沿用A ffb8aec1 CLI与固定bdf706d7 HAPI。
- 故障自检：`.dev-smoke/slimming-acceptance/t6b-model-home-cleanup.ts`仅本次合成source，非法TOML使构造失败，全部五份复制文件移除且source未改，日志`t6b-model-home-cleanup.log`；未操作用户home。首次execution setup因helper误用旧server.noRunner失败，已改当前server.runner=false，失败根execution-kOXoH5保留配置诊断，无模型启动。没有产品契约缺口或provider失败。

自检实际命令/结果如下，日志均在`.dev-smoke/slimming-acceptance/`，证据均为各根的`evidence.json`：

| 命令 | 日志 | Evidence根（.dev-smoke/） | 实际结果 |
|---|---|---|---|
| bun run test:execution dist/runweft | t6b-execution-final.log | execution-BTP8sv | 11组，双runtime，exit0/cleanupErrors=[] |
| bun run test:mcp dist/runweft | t6b-mcp-final.log | mcp-WeirZT | 13组，两独立home×双host/双runtime start+resume及协议probe，exit0/cleanupErrors=[] |
| bun run test:workspaces dist/runweft dist/hapi | t6b-workspaces-final.log | workspace-http-28Un0B | 双runtime全部原proof/seal/missing checkout断言，exit0/cleanupErrors=[] |
| bun run test:inputs dist/runweft dist/hapi | t6b-inputs-final.log | inputs-native-SD7nJZ | 机器前置2组+双runtime四输入轮，exit0/cleanupErrors=[] |
| bun run test:inputs dist/runweft dist/hapi --machine-only | t6b-inputs-machine-final.log | inputs-native-ReWVIk | 2组、零session模型，exit0/cleanupErrors=[] |

- 上述成功roots实际仅剩evidence/顶层日志；execution/MCP仅evidence。最后主agent静态要求恢复compiled status.hapiRevision pin断言、MCP hub地址断言、去掉领域candidate写死no-model及清理失败续行，已修后typecheck通过；最后同版四默认真实重跑由主agent承担，不能把修改前证据伪装同版实跑。实施源码已冻结，无commit/T6完成/后续批次，未修改data-format-research/HAPI/依赖/version/Specs。

- 主 agent 批次验收：最终冻结源码下独立四默认入口全部 exit0：execution 11组/两runtime，MCP 13组/八case，workspaces 两runtime，inputs 四真实模型轮；另独立 machine-only 两组零模型、repository-export 两组及 typecheck 通过。六现场 cleanupErrors 均空，只剩证据/顶层日志，记录的原生host PID已不存在；四份源配置的hash、mode、size不变。根另用合成配置验证部分复制失败后继续清理、活host拒绝清理、退出后回收，未触碰用户配置。实际证据汇总 `.dev-smoke/slimming-acceptance/t6b-root-summary.json`，命令日志 `t6b-root-*.log`，source/compiled分层及冻结源码hash随汇总保留。批次B通过，T6尚需高层任务、远端、留存与原生矩阵等剩余入口，不提交本任务或宣称最终格式验收。

## T6 批次C：真实高层Task与outputs→retention

- 范围仅六Task脚本及五必要helper：task-smoke/non-git-smoke-project/task-capture-receipt新建；native-user-smoke暴露compiled server/raw CLI/current runtime/restart/专用handoff关闭；model-homes加可选requireClaude以保留tasks原Codex-only前置（默认双runtime不变）。全部高层Task经compiled serve真实coordinator，没有领域种子/第二扫描器/旧API翻译。current public owner×space、真实机器/中央Agent UUID；inputs/outputs Git项目均当前repository create/bind。
- 原保障去向逐项见smoke-coverage T6C。controls保留真实model/effort/审批副作用/steer/execution interrupt，将历史YAML冻结假设改成已确认的current next重新resolve：只update instructions，首轮snapshot原样、新轮新version，固定target/launch与nativehistory。task-mcp保原machine/cwd Task list，真实两host thread/system nativeID与child proof，限定审批、一次spawn、65秒cursor timeout；没有扩大owner库存。
- non-Git首个tasks复现repository_unmatched：当前observeRepository明确清GIT_CEILING_DIRECTORIES，仓库下.dev-smoke/project真实是Git子目录。不是产品缺口。经主agent确认，改为系统tmp本次唯一root/.dev-smoke/project、先assert non_git，三脚本finally尝试回收该新root；evidence记录路径，不动用户或历史临时目录。
- outputs→retention唯一格式current-task-outputs-1，同候选binaryhash校验与真实八case路径。producer模型host/Runner/服务已停、源配置hash验证后清复制模型auth，只保留consumer需要的当前DB/Git/files与Hub身份/机器/HAPI连接。consumer不再复制或启动模型，以公开Task/artifact/current owner会话操作和本次Runner只读receipt/spool观察；manifest对应operation/action/cwd/name/relativePath/hash/size全验证，不开放机器RPC。全部release/history/Git/spool事实确认后，终止consumer恢复quota/停进程/删除确切秘密，再回收本次producer可再生数据。两家最终仅evidence；对失败仍保留诊断。

自检默认实际结果（使用A的ffb8aec1 CLI和固定bdf706d7 HAPI；未改产品，未build重建HAPI）：日志均`.dev-smoke/slimming-acceptance/`，证据均以下根的evidence.json。

| 实际命令 | 日志 | Evidence根（.dev-smoke/） | 实际结果 |
|---|---|---|---|
| bun run test:tasks dist/runweft | t6c-tasks-current.log | tasks-udeACs | 四组、Codex真实执行，exit0/cleanupErrors=[] |
| bun run test:task-controls dist/runweft | t6c-task-controls.log | task-controls-rGSF1r | 七组、双runtime审批/steer/interrupt，exit0/cleanupErrors=[] |
| bun run test:task-mcp dist/runweft | t6c-task-mcp.log | task-mcp-krg8yM | 两host各两组，实际长wait 64859/65181ms，exit0/cleanupErrors=[] |
| bun run test:task-inputs dist/runweft | t6c-task-inputs.log | task-inputs-iRaJBB | 默认双runtime×两mode×两round八组，exit0/cleanupErrors=[] |
| bun run test:task-outputs dist/runweft | t6c-task-outputs.log | task-outputs-weHP8R | 默认四task八round及每首轮partial/retry/collect，exit0/cleanupErrors=[]，交唯一consumer |
| bun run test:task-retention .dev-smoke/task-outputs-weHP8R/evidence.json dist/runweft | t6c-task-retention.log | task-retention-Z2VRxy | 三组、八轮留存/真实candidate discard/重启零重放，exit0/cleanupErrors=[]，producer回收 |

- 定向根实际44 pass/0 fail/1081 expect/五文件（tasks/task-rounds/tasks-mcp/task-outputs/hub-delegation-native），日志t6c-focused-tests.log；首条命令中的./test/task-inputs.test.ts并不存在，未声称它通过。补当前./test/task-files.test.ts，7 pass/0 fail/145 expect，日志t6c-task-files-tests.log。没有删或改根有效断言。
- 最后source修整：ready按实际所需flavor的discovery返回而非强迫tools.length===2；retention清HAPI_/RUNWEFT_/CLI_API_TOKEN/DB_PATH等外层变量，不恢复用户home认证。known各round host PID加入退出确认。初次自检全模型通过后的这些修整由主agent最终版本独立实跑，不以先前版本证据冒充。
- 真实验收返修：清unused imports误删tasks最后evidence写入所需join。主agent最终版本跑到四行为组全过，但finally ReferenceError/exit1，typecheck也报TS2304；我此前组合命令取到末尾diff-check的成功出口，漏看typecheck失败，不能据此称通过。仅恢复join import后，独立命令bun run typecheck实际exit0，日志t6c-typecheck.log；主agent重跑tasks/typecheck，其余C源码仍冻结。最终六家验收尚待主agent记录。
- 冻结六脚本/五helper的精确SHA256清单在t6c-implementation-hashes.json，已包含join恢复。未改data-format-research/HAPI/pin/依赖/version/Specs，未commit、未标T6完成、未开始下一批。其它当前矩阵由主agent另安排，仅不与本批共享helper编辑。

- C task-mcp 最终独立验收返修：主agent现场task-mcp-CM3ah4中Codex递归拒绝及65秒wait通过，Claude额外提出本次项目ls/git权限请求，原assert(expected)使入口exit1；cleanupErrors=[]。仅该脚本解冻：提示明确不检查目录、不运行ls/git及被拒后不重试额外请求；未声明helper/proof请求经现行task permission明确denied并记录deniedRequests，声明请求仍按原白名单批准。原唯一spawn、真实helper/proof、递归拒绝、completed及65秒wait断言全部保留，不新开Round/重发Task，不修改HAPI默认denial reason或产品权限。该版本等待主agent完整两host复跑；前一失败不记为通过。

- 主 agent 批次验收：最终冻结六入口独立全部 exit0：tasks 四组、controls 七组/双 runtime、task-mcp 双 host 四组且实际长 wait 65012/65209ms、inputs 八轮、outputs 八轮、retention 三组/八轮。outputs 交接时确认模型进程退出与模型认证副本删除；retention 实际验证失败候选拒绝普通释放、显式丢弃、外部引用与全部历史不变、配额和重启零重放后，两现场均只剩 evidence。六现场 cleanupErrors=[]，所有记录的 host PID 消失，三个 non-Git 临时根已回收，四份用户源配置 hash/mode/size 不变；13份脚本/helper 与候选 hash 对照最终冻结清单一致。独立 typecheck 通过；保留 join 导入及未声明 Claude 请求两个失败记录，修正后才记录通过。汇总 `.dev-smoke/slimming-acceptance/t6c-root-summary.json`，日志 `t6c-root-*.log`；沿用 ffb8aec1/bdf706d7，无本批产品变更、未重复 build/根全集。批次C通过，T6继续远端和剩余矩阵，未提交。

## T6 当前原生十二组与消费者十组

- 迁接线只复用实际 modelHomes，保留原矩阵/筛选参数、真实浏览器 encrypted begin/complete、原生宿主 ID、递归委派拒绝、双 owner 权限和消费者全部恢复控制断言。新建 native fixture 不再调用 data reset；两家构造后操作纳入 finally，逐会话/Runner/服务/PID确认，安全后清确切模型与连接秘密。默认成功回收本次环境；显式当前 handoff 仅用于 T7 最终浏览器消费者，不接受历史 fixture 格式。
- 主 agent 以专用 prefix 离线安装本地 Linux x64 tarballs，实际 npm launcher 指向同 ffb8aec1/bdf706d7 候选；未发布、未改用户全局配置。清单 `t6-installed-linux.json`，package/install 日志 `t6-{package,install}-linux.log`。
- 最终版本独立原生默认 all/all/all 成功：12 cases/12 Task/12 round、18 checks，四次实际 long wait 65010/65094/64985/65312ms；cleanupErrors=[]、24记录PID消失、源配置 hash/mode/size 不变，模型认证副本删除。为 T7 明确保留当前 state/HAPI history/Git 与 0600 连接文件，cleanupOwner=T7 final consumer。证据 `.dev-smoke/hub-native-mcp-jSgCqe/evidence.json`，汇总 `t6-current-root-native-summary.json`，日志 `t6-current-root-native.log`。
- 最终消费者独立默认成功：10 checks、tasks数组6项/5唯一Task/11唯一round；cleanupErrors=[]、记录PID消失、仅余evidence、源配置不变。证据 `.dev-smoke/hub-consumers-1cdGb4/evidence.json`，汇总 `t6-current-root-consumers-summary.json`，日志 `t6-current-root-consumers-final.log`。
- 根首消费者现场 xll7fw 在两项异步 release 后过早 workspace remove，正确收到 result_remove_pending，入口exit1；保留诊断并确认所有记录PID与秘密副本已清。仅脚本增加公开 task/result DTO 的真实释放确认后再一次 remove，不重试 mutation、不改产品并发保护。修后完整十组才记通过。此前实施者自检成功属较早清理版本，不能冒充最终版本验收。
- 两家最终源码与五个冻结依赖/candidate hash 已独立核对，清单 `t6-current-root-inputs-v2.json`。这是真实本机 Linux 双 Runner/模型/浏览器接入验收，未验证物理跨机器；T6其它模型家族仍进行中，未提交或认领最终 schema19。

### T6D 实施中：远端成果/当前连接

- 仅 result-export(default/--fetch/--tasks)、task-results-probe、remote-native(default/--tasks)、remote-task-probe、result-retention；remote-package 由主agent派 E producer 同步迁，本项未编辑或声称其通过。共享窄扩展由主agent批准：nativeUserSmoke 第四可选 hapiBinary（默认不变），nativeFileSmoke.restart(scan=false)/reopenGateway(scan=false) 完整重建；modelHomes 未改。
- 自检 result-export 四组 xaDG0F、result-fetch 五组 8nrz6B exit0/cleanupErrors=[]，原真实双 Runner、Git/LFS、丢成功回执/原ID查询、partial seal、冻结首轮 bytes、离线 object 下载和保护父 index/config/HEAD/FETCH_HEAD/dirty/hook/模块合码保障保留。最终 TaskResults JhaqWq（三组）自检 exit0，证据嵌入 taskResults，原无模型领域层级明确；主agent正独立最终版三入口验收。
- TaskResults 初 jYNhw8 在新 gateway 后私有 prepare HTTP500；随后 sO2r63 的固定 export 写 unknown。初scan早于实际RPC重连是调查方向，不将其混同已证实的同进程 spawnSync CLI 死锁：AGoufT 两轮 publication 完成后同步 compiled CLI 阻塞本进程 HTTP 报 connection_failed，改异步 compiled CLI 后 jseuVZ 及最终 JhaqWq 实测通过。等待 unknown 沿当前原操作恢复，没有新 export/新种子掩盖不确定回执；未修改产品 retry。
- default 模型首 KdURs8 Codex两轮/两runtime六gate通过，Claude额外 ls memory+重定向请求违反原 allowlist，整入口失败；仅强化提示不读外部memory、不ls/重定向，未放宽审批。该首草稿 cleanup 调用顺序误用逆序工具，先删模型副本/后等PID导致真实清理失败，不能称安全通过；已改本家正确顺序。已依据本次 HAPI metadata 且验证 owned cwd 停 PID1499384；Y8ptBq 四已知host均已消失，补证据 t6d-first-native-cleanup.json/t6d-first-task-cleanup.json。
- k7nRyi default 通过首轮Claude后次轮resume missing，cleanupErrors=[]；Y8ptBq Task 第一Codex两轮/Claude首轮后次轮同nativeID失败，真实固定HAPI长路径限制见Technical。本家按主agent授权使用短 tmpRoot/.dev-smoke，新默认矩阵 Sj4nDX、wajJet 实跑中，尚不声称最终通过。
- 当前定向 bun test ./test/remote.test.ts ./test/remote-tasks.test.ts ./test/task-results.test.ts ./test/hub-delegation-native.test.ts 实际34 pass/0 fail/816 expect/4文件（t6d-focused-tests.log）；最新独立 typecheck exit0。初并行 E 草稿曾报类型错，随后收敛；不把该瞬时失败当本批最终通过。

- 主 agent 三个无模型成果入口验收：最终冻结源码，以实际本地安装的 compiled core 与 HAPI 分别独立执行 `test:result-export`、`test:result-fetch`、`test:task-results`，全部 exit0。export 四组/两导出/一次真实成功响应丢失；fetch 五组/两导出两取回/三次真实响应丢失；TaskResults 三组/两固定业务轮，完整当前 gateway 重建后恢复出版，第二次恢复零重复上传，compiled CLI 与当前 MCP adapter 分别离线取回。三家均零模型 session，不能替代真实模型 Task 验收。固定 Git/LFS 字节、源和执行端离线、父 Git 状态保护、子模块/LFS 显式合入均实际验证。
- 三个根分别为 `.dev-smoke/repository-result-export-0wOdlA`、`repository-result-fetch-2eWjPF`、`task-result-delivery-rCqN4m`；cleanupErrors=[]，成功现场仅证据/进程日志。候选仍 ffb8aec1/bdf706d7；源码及候选核对和结果保存于 `.dev-smoke/slimming-acceptance/t6d-root-results-{inputs,summary}.json`，命令日志 `t6d-root-{result-export,result-fetch,task-results}.log`。三入口通过，D真实模型及retention仍待验收，不提交或标T6完成。

- D 模型与consumer后续自检：default补回真实copied config中的Runweft MCP后，o1jkVo八组exit0/cleanupErrors=[]；两runtime各两真实native轮同ID，实际MCP配置存在且Runweft被过滤、keep_probe仍执行，四host退出、源配置hash验证，auth副本及本次MCP config备份在退出后删除，ownedTempRoot精确回收。jEl4jv Task默认双runtime×两轮+offline fetch/merge全部通过/cleanupErrors=[]，但该启动版本尚无恢复的MCP configured前置，不能代替最终版本filter保障；其当前数据格式/真实Task事实仍由独立retention消费：KZdKmG四组exit0/cleanupErrors=[]，release preview/独立round refs/共享cache首删保留末删物理回收/离线fetch/Git refs与sessions不变，最终/tmp/runweft-remote-GkGOkI回收，仅两家evidence。
- 最终Task配置矩阵另开新fixture实跑（t6d-remote-tasks-configured.log），保原强断言。新增本家cleanup失败路径保证：各session stop独立尽力；factory未返回不默认已停机；配置hash/remove失败导致整体handoff失效时，如模型与基础进程已确认停止，仍清精确连接身份/机器/HAPI settings/JWT，不遗留无效handoff。无模型已冻结三家/sharedhelpers未改。
- 同机两独立Runner/native home和机器UUID、真实HTTP/Git/LFS/模型，未验证物理异机网络；远端访问条件缺口仍保留，不把本次本地双Runner验收称物理远端。


### T6E 原生历史重建：主 agent 验收

- `smoke-reconstruction.ts` 保留双 runtime 四真实轮次与可选 failed-evidence 参数，当前连接/机器/Task 不变，在空原生历史下通过真实 missing 分支重建。当前证据格式仅有 `current-reconstruction-1`；继续失败现场须未接受第二轮、首轮已完成停机、同候选及身份/路径/当前记录全部一致，拒绝已接受第二轮的再次提交。这是本次验收断点恢复，不是旧数据兼容。
- 最终提示明确首轮正文与结构化字段都不回显记忆标记，原断言不变。根初次 Zcf45v 中 Claude 在 summary 自行复述标记，正确 exit1；cleanupErrors=[]、模型PID退出、临时non-Git项目删除，保留失败证据。未重发该Task或改写其报告。
- 主 agent 以实际安装 launcher 与显式 HAPI 独立执行最终 a12d0155 脚本，wa6hwy exit0/七组：Codex/Claude各两轮，四个 archived session；新轮消息不含旧标记，重建来源只首轮，实际两种原生JSONL均恰一条当前轮输入且含恢复记忆；原history SHA/报告及空项目不变。四host退出、non-Git临时根删除、成功根只余evidence、cleanupErrors=[]、源模型配置SHA与冻结源码均相符。
- 根再把此已接受第二轮的真实成功证据传第三argv，预期exit1且在启动前拒绝，evidence bytes及文件集不变。实施者另外已真实执行故障窗口pt6CM8两首轮→同现场继续两个第二轮，first Task/Round/native ID未变、四最终session，无重放；这项是实施者证据，非根重复执行。默认早期自检/故障/继续与最后提示修正版本分别记录，不合并成一次验收。
- 根汇总 `.dev-smoke/slimming-acceptance/t6e-root-reconstruction-summary.json`，源码/candidate清单 `t6e-root-reconstruction-inputs-v2.json`，日志 `t6e-root-reconstruction-{default-v2,second-refused}.log`；候选仍 ffb8aec1/bdf706d7，产品/HAPI未变。其余E链仍进行中，不据此标T6完成。

- D 最终模型链自检：`bun run test:remote-tasks dist/runweft dist/hapi` 的 WjiLDJ exit0/五组，两runtime各两轮真实协调器Task、同nativeID恢复、四seal故障修复及离线fetch/merge，Runweft MCP configured前置实际为true；`bun run test:result-retention .dev-smoke/remote-tasks-native-WjiLDJ dist/runweft dist/hapi` 的 k5pauW exit0/四组，两家 cleanupErrors=[]。最终consumer精确回收 /tmp/runweft-remote-Jt9vym，留下紧凑evidence/log。日志 t6d-remote-tasks-configured.log、t6d-result-retention-final.log。D模型与consumer交主agent独立验收，未标T6完成。
- 最终生命周期窄修：只有默认all Task producer保留数据交result-retention；合法单flavor成功由producer回收，证据明确cleanupOwner/retainedForConsumer。默认all实跑不受此分支修正影响；单flavor修正本轮只静态核验。已记录的四失败现场确切backup目录检查无残留，t6d-failed-backup-check.json；不扫描历史目录。
- 主agent要求的已验C清理补齐：task-mcp安装返回backupPath立即登记既有models.copies；taskSmoke构造未返回center时不把基础进程当已停止，不删除模型认证副本。先前C真实矩阵在该窄修前，未声称重跑；最终typecheck exit0（t6d-final-typecheck.log），T13保留整体验收。


### T6E 附件原生矩阵与安装消费：主 agent 验收

- 当前 producer 以真实编译中心/CLI、两 Runner 与 MCP 宿主执行原八组合/十六轮，实际 upload/input/output、partial→retry拒绝→collect、第二轮原bytes、child工具边界均保留。root默认 Qn6bmR 全部八组成功，源码与启动清单cb889671逐项相等、模型PID退出、原模型配置副本清除。安装 consumer u33pgy 的八组只读重启检查全部通过：原轮次/report/input/native/session/manifest与真实文件SHA/bytes不变，原生history摘要不变。
- 该默认 consumer 随后的 release→worktree remove 后 deepEqual 整个 rounds 失败：正常释放令 artifacts_revision 从53/94增加到103/106，执行完成版本、轮次和请求未变；这不是产品回放或数据兼容缺口。消费者仅在明确释放后的比对拆出可变留存修订号，要求非下降，其余完整执行字段保持相等；释放前仍完整exact比较。原 consumer 保留exit1事实，不改成通过。
- 最终 producer 同时补 MCP 安装实际返回 backupPath 的安全回收；root用最终5bff565f producer与c73a322b consumer对两个跨runtime worktree组合独立执行完整链：hub-claude-codex 的5I4ep7→Q5dHu6、hub-codex-claude 的86eJJ9→KythXJ，两producer/两consumer均exit0。全部原bytes、报告/native历史、释放完成、实际workspace删除、父HEAD/status与每轮Git ref/result blob保留通过；仅剩evidence/logs、记录PID均消失，源配置hash/mode/size不变。此前默认全部八组真实只读保障与这两个最终释放链分开记录；T13再执行最终默认完整链。
- 汇总 `.dev-smoke/slimming-acceptance/t6e-root-artifact-summary.json`；默认及selected命令日志 `t6e-root-artifact-*.log`，两版源码和candidate清单随日志保存。已确认失败默认两现场无进程并精确清凭据/MCP备份后，root回收其本次可再生数据，只留原始evidence/log；补充清理记录 `t6e-root-artifact-failed-consumer-cleanup.json`。使用同ffb8aec1/bdf706d7安装候选，无产品或HAPI改动。

### T6 临时 MCP 配置备份的最后复核

- 实际 `mcp install` 备份含完整专用宿主配置，原 modelHomes.remove 只知道初始复制文件。artifact/current-native/task-mcp 三家改为把每次CLI返回的backupPath立即登记到已有copies数组，安全停机后由原逐项清理删除，不扫目录或用户home、不新增清理框架。task-smoke另修构造AggregateError且center未返回时不能默认停机后删除模型凭据。后两家的已通过完整矩阵是在此窄清理返修前，不冒称已经重跑；静态复核/typecheck通过，T13最终同候选验收会使用返修版。
- root对当前T7 handoff jSgCqe 的一个安装备份及已失败task-mcp-CM3ah4的一个备份，确认专用服务/Runner停机、已知进程退出、备份内路径归本次root后精确删除；原evidence不变。jSgCqe当前state/nativehistory/Git/连接继续交T7。证据 `t6-current-root-backup-cleanup.json`、`t6c-root-failed-mcp-backup-cleanup.json`。这是本次验收副本回收，不是旧版本用户数据清理。


### T6D 最终默认原生与Task→retention：主 agent 验收

- root以固定安装core/HAPI独立跑最终c086239a producer：默认native vWPXeA exit0/八组；compiled Task 8aheeA exit0/五组。均双runtime各两轮、同native ID复用、实际工程/skill/input/submodule/LFS内容、现有Runweft MCP配置被过滤而其它MCP实际调用、原生进程退出；native另保两runtime各六个实际prepared-state拒绝且无新session、source与target离线后真实中心Git/LFS对象可下载。Task保真实seal hook失败修复、自动代码/文件发布、执行端离线由CLI fetch、父index/config保护及显式Git/LFS合入。
- root继续同一8aheeA的当前handoff，用最终211464a1 retention consumer MA3NHE，exit0/四组：preview不unpin、仅释放首轮保共享baseline/LFS pin；删首Task保共享cache与第二checkout，删末Task才物理清cache；执行端已离线且checkout/cache已删仍能取回两份最终成果，父refs/index/config不变；最后中心pins独立释放、session IDs不变。producer未新dispatch或重新拷贝模型认证。
- 三入口cleanupErrors=[]；所有记录host PID已退出，native与Task两独占system tmpRoot/.dev-smoke均已回收、证据目录只余evidence/log、MCP备份删除，源配置hash/mode/size不变。候选仍ffb8aec1/bdf706d7、root源码hash对照冻结清单通过。汇总 `.dev-smoke/slimming-acceptance/t6d-root-summary.json`，命令日志 `t6d-root-{native,tasks,retention}.log`。合法单flavor成功由producer自行回收、仅default双runtime交retention的窄分支只静态核对/typecheck，未声称root另跑了单flavor。
- 本次使用明确owned短运行目录；固定HAPI对长Claude cwd编码与实际原生历史目录不一致的已复现限制仍在，未改HAPI/复制transcript/建立兼容路径。短目录同nativeID成功不能声称已修复长路径限制。D全部入口通过本阶段验收，T6其它E矩阵仍待完成，未标整任务完成。


### T6E 原生 MCP 控制：主 agent 验收

- root 使用固定安装 ffb8aec1/bdf706d7 和 producer 4131511b 独立执行两种宿主/runtime 控制链：Codex GvlmS0 四轮、Claude RAYamM 三轮，均 exit0。每家唯一 spawn，第二轮同 native ID 恢复且只报告不改文件；Codex 原轮双输入实际 steer 成功，Claude 明确 steer_unsupported；最后新轮实际 accepted 后 interrupt，同 execution ID 变为 interrupted/stopped/complete，没有重发。
- root 逐项复核原 MCP 调用和 round views、真实 native 终态、记录 PID 全部退出、owned 短运行目录已删除、证据目录只余 evidence、cleanupErrors=[]，源四份配置 hash/mode/size 不变。汇总 `.dev-smoke/slimming-acceptance/t6e-root-collaboration-controls-summary.json`；两个命令日志为 `t6e-root-collaboration-controls-{codex,claude}.log`。后续 producer 04d2e86b 仅修改 worktree/remote 提示及错误 stack，shared controls 分支未变；默认 worktree/remote 与 finish-repair 尚在独立验收，不能据此标 T6 全部完成。


### T6E 独立工作树 Task 与 lifecycle：主 agent 验收

- root 首次 NHRa0p 在 Claude 第二轮误拒合法只读 Git：模型用分号串联同 prepared cwd 的 status --short 与 log --oneline -3，测试只拆 &&。仅改为两种分隔符逐段校验，原命令/当前cwd枚举与空段拒绝保持；不是批准任意 Bash。原失败证据保持、九个记录PID退出、ownedRoot回收，不在已接受的第二轮现场重发。
- root 用最终 efae36c1 tasks / 391dc35d lifecycle / a70c9b01 helper 和固定 ffb8aec1/bdf706d7 安装候选独立执行默认链：8sbJQL producer 五组/四真实轮，随后同现场 yMsL7n lifecycle 六组/两个真实第三轮、两个准备取消Task，均 exit0。两runtime工程指令/skill/project MCP实际调用、结果编辑与Git封存、两次同nativeID恢复、第三轮只读ignored依赖无新commit均通过；Claude首轮真实失败hook由单次CLI retry-finish修复，原inputs/report不重放。
- lifecycle保留实际post-checkout延迟窗口：接受后父HEAD推进，preparing中interrupt仍固定原base、不创建session；ignored内容令remove失败，重启后显式discard才移除checkout，原三轮报告/result refs及准备取消成果保留，后续send拒绝。root逐项复核终态、十二个记录PID全退出、唯一运行tmpRoot删除，两家证据目录仅evidence、源配置hash/mode/size不变。汇总 `.dev-smoke/slimming-acceptance/t6e-root-worktree-summary.json`，日志 `t6e-root-worktree-tasks-v2.log`、`t6e-root-worktree-lifecycle.log`。此链通过，协作矩阵其它分支仍在验收。

### T6E 协作矩阵与安装消费：主 agent 验收

- root以同ffb8aec1/bdf706d7安装候选独立执行worktree gPq2Pu，8case/18轮全部通过，包含两个相反宿主/runtime的真实MCP连接断开；每家单次spawn、同native历史、context/skill/保留MCP真实调用、Git封存与显式合入、只报告不改mtime，父HEAD/index/dirty状态保持。共享8case/18轮MI1twF为实施者真实执行、根逐项复核；root没有把它记成自己重复运行。两类成功矩阵全部记录PID退出、自有短目录回收、源配置不变。
- root native retry-finish mbmMVX两轮→安装worktree consumer VPbpC2均exit0：首轮模型已完成而真实hook失败，恰一次原轮次retry_finish、原输入/报告不重放；消费者重启读取原历史，实际checkout与doctor计数1→0、Git refs和父状态保留。之前5zUPXx是已从精确原生history独立确认的server_overloaded，尚未retry，保留失败且不复用现场；没有改模型、扩大审批或自动重发。
- root默认remote BlkHGo四case/八轮全部原实际Git/LFS/input/output、双Runner离线取回及显式合入断言通过。其安装consumer AWbF2R在启动后的第一项snapshot比较失败，尚未执行consumer下载/fetch/release：producer模型结束时保存DTO，后续正常offline fetch使末轮code_revision从137/147/137/149增至145/155/145/157，其余执行/completed/artifacts字段未变；失败不能记为消费者通过。
- 最小返修仅remote业务动作完成后重采完整两轮DTO；consumer自身显式fetch绑定唯一requestId/roundId、等待available+released并核resultHead，再把该次实际code_revision作为对应轮次的精确预期。其它轮次/执行字段、inputs、报告、native history、session库存继续exact；释放后才使用原留存修订非下降检查。root用最终producer5f2c337c/consumer1a2f3300/helper3aea3b2a独立跑两个跨runtime完整链：uOAImS→MrrJFs（hub-claude-codex）、5w1CcT→X9Cf7M（hub-codex-claude），四入口均exit0。实际执行端离线、下载SHA/bytes、再次fetch保父index/config、release/remove/no-replay与终结清理通过，仅剩紧凑证据；源配置hash/mode/size不变。最终默认完整四case消费链留T13，与此前default生产者证明分开记录。
- 原worktree/remote的审批失败和报告标记失败均保留：只把只读Git分号串联纳入原逐段allowlist，明确仅原生会话记忆及完整报告字面标记；权限拒绝保持，未放行cwd外persistent memory。失败诊断、已停止进程/精确秘密回收记录与原evidence独立保存。
- 汇总 `.dev-smoke/slimming-acceptance/t6e-root-collaboration-{default-producers,retry}-summary.json`、`t6e-root-remote-final-summary.json`；对应root命令与源码/candidate清单保存在同目录。全部T6入口已具当前可执行保障与逐场景证据，根typecheck通过；T6A产品Socket窄修后根全集274pass/0fail，后续只有smoke/fixture迁接线及明确清理返修，未声称再跑一套未执行的全集。T13仍执行最终同候选组合，物理跨机/Mac实机/arm64模型及固定HAPI长Claude cwd限制不冒充已验证。
- Commit：`module-slimming-audit T6: 迁移原生与成果验收并收口环境清理`
