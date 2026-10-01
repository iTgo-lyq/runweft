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
