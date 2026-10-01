# Hub 集中配置交付拆分

> 更新：2026-10-01。用户已确认开始；既有自动实施、iclaude Plan 评审和本地自动验收授权继续有效。

采用增量扩展、接入迁移、最后切换默认行为的顺序。每个领域只由一个 Change 实现；中间版本仍可运行，未接通的新身份不取得旧 HAPI 访问权。全部领域通过后才交付新的完整使用路径。

| 顺序 / Change | 独立交付与验收结果 | 依赖 |
| --- | --- | --- |
| 1 [身份 token 与空间（已完成）](../../archive/2026-09-30-hub-identities-and-spaces/requirement.md) | 无注册创建/导入身份，Web 管理本人空间和成员，撤销和权限由服务端判断 | 无 |
| 2 [HAPI 访问授权（已完成）](../../archive/2026-09-30-hub-hapi-access/requirement.md) | HTTP、SSE、Socket、Runner 有统一主体和对象权限；真实 HAPI 集成验证 | 1 |
| 3 [机器/runtime 归属与共享（已完成）](../../archive/2026-09-30-hub-resource-ownership/requirement.md) | 机器登记和 runtime 注册独立，有所有者、空间授权、私有/共享规则 | 1、2 |
| 4 [仓库与中心 Agent 配置（已完成）](../../archive/2026-10-01-hub-repository-agents/requirement.md) | 同仓库不同用户有独立定义/偏好，中心版本快照及目标解析 | 1、3 |
| 5 [委派接入及配置切换（已完成）](../../archive/2026-10-01-hub-delegation-migration/requirement.md) | MCP/CLI 必连 Hub，按身份与空间委派；旧试验历史直接清理 | 2、3、4 |
| 6 [Web 管理及 Agent 接入 Skill（已完成）](../../archive/2026-10-01-hub-console-onboarding/requirement.md) | 完整资源后台、Agent 执行安装接入流程、官网与诊断一致 | 3、4、5 |
| 7 本 Change：集成发行（已完成） | 1.1.0同一安装程序的首次接入、多人权限、十二组MCP、十组消费者与维护，四平台/Skill/官网/对应源码完整交付；见[验收](acceptance.md) | 以上全部 |

## 共享契约归属

- 身份 token、稳定 userId、spaceId、membership、邀请与撤销归 1；后续引用，不重复建账户表。
- HAPI 主体到原生 namespace/会话/机器的可信映射及通道授权归 2。必须先复现缺口；如需 HAPI 通用入口补充，独立 fork 维护，不重写 launcher。
- machineId/runtimeId、资源所有者和向空间共享的执行权限归 3；机器不是项目子对象。
- Repository ID/别名、Agent ID/版本、用户 × 空间 × 仓库的个人选择归 4；业务配置以 Hub 为准。
- Task/Round 的发起身份、空间、配置快照与结果可访问范围归 5；原生执行、工作区和成果传输继续复用。
- 页面和 Skill 消费领域接口，不能在前端/提示词另造权限规则。最终集成不承接遗漏的领域功能。

## 执行约束

同一工作区串行实现；每个 Change 的 Technical 依据实际代码形成、Plan 经 iclaude 评审后落实。只因额度耗尽改用新 subagent。自动验收使用专用目录，网页使用 Playwright；物理远端条件缺失则如实保留缺口，Mac 双架构产物照常构建。既有在线 Hub 的部署更新不随开发自动执行。

身份/空间的完整独立 API 和 Web 流程已验收归档。HAPI 多用户桥接在阶段 2 验证，阶段 1 不把新 token 翻译成原有 root 凭据。默认入口和连接配置已在阶段 5 切换并验收；阶段 6 后台/Skill与阶段 7 同候选整体发行均已完成。全部本地验收由Agent执行，Mac实机与物理远端边界见Acceptance。

## 后续执行交接

2026-10-01 用户确认：主 agent 完成整个第五阶段（含该 Change 的历史清理/简化、组合验收、Specs 同步与归档）后，在当前工作区启动 traex，指定 astra 模型，接手整体第六阶段 Hub 后台与 Skill、第七阶段集成发行。确认任务启动后交接，不等待 traex 执行结束，并结束当前 goal。第五阶段已完成内部 T1–T7 和[组合验收](../../archive/2026-10-01-hub-delegation-migration/acceptance.md)，实现提交截至 `1357cd1`；Specs 同步和归档随本次独立归档提交完成。交接从第六阶段开始，在同一工作区串行推进，不重复实现第五阶段。traex 实际模型名为 `gpt-6-astra`；启动回执与日志保存在本机 `.dev-smoke/traex-hub-phases-6-7-*`。

历史兼容按用户 2026-10-01 最新决策简化：尚未上线的数据可直接清理，不为迁移创建转换/回退框架；第五阶段 T6 同时清理过度封装。
