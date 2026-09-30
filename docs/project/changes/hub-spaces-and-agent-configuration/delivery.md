# Hub 集中配置交付拆分

> 更新：2026-09-30。用户已确认开始；既有自动实施、iclaude Plan 评审和本地自动验收授权继续有效。

采用增量扩展、接入迁移、最后切换默认行为的顺序。每个领域只由一个 Change 实现；中间版本仍可运行，未接通的新身份不取得旧 HAPI 访问权。全部领域通过后才交付新的完整使用路径。

| 顺序 / Change | 独立交付与验收结果 | 依赖 |
| --- | --- | --- |
| 1 [身份 token 与空间（已完成）](../../archive/2026-09-30-hub-identities-and-spaces/requirement.md) | 无注册创建/导入身份，Web 管理本人空间和成员，撤销和权限由服务端判断 | 无 |
| 2 [HAPI 访问授权（已完成）](../../archive/2026-09-30-hub-hapi-access/requirement.md) | HTTP、SSE、Socket、Runner 有统一主体和对象权限；真实 HAPI 集成验证 | 1 |
| 3 [机器/runtime 归属与共享（已完成）](../../archive/2026-09-30-hub-resource-ownership/requirement.md) | 机器登记和 runtime 注册独立，有所有者、空间授权、私有/共享规则 | 1、2 |
| 4 [仓库与中心 Agent 配置（已完成）](../../archive/2026-10-01-hub-repository-agents/requirement.md) | 同仓库不同用户有独立定义/偏好，中心版本快照及目标解析 | 1、3 |
| 5 [委派接入及旧配置迁移](../hub-delegation-migration/requirement.md) | MCP/CLI 必连 Hub，按身份与空间委派；旧文件/历史显式迁移 | 2、3、4 |
| 6 [Web 管理及 Agent 接入 Skill](../hub-console-onboarding/requirement.md) | 完整资源后台、Agent 执行安装接入流程、官网与诊断一致 | 3、4、5 |
| 7 本 Change：集成发行 | 同一版本的首次接入、多人权限、两宿主/两 runtime、本地及远端链路、四平台构建 | 以上全部 |

## 共享契约归属

- 身份 token、稳定 userId、spaceId、membership、邀请与撤销归 1；后续引用，不重复建账户表。
- HAPI 主体到原生 namespace/会话/机器的可信映射及通道授权归 2。必须先复现缺口；如需 HAPI 通用入口补充，独立 fork 维护，不重写 launcher。
- machineId/runtimeId、资源所有者和向空间共享的执行权限归 3；机器不是项目子对象。
- Repository ID/别名、Agent ID/版本、用户 × 空间 × 仓库的个人选择归 4；业务配置以 Hub 为准。
- Task/Round 的发起身份、空间、配置快照与结果可访问范围归 5；原生执行、工作区和成果传输继续复用。
- 页面和 Skill 消费领域接口，不能在前端/提示词另造权限规则。最终集成不承接遗漏的领域功能。

## 执行约束

同一工作区串行实现；每个 Change 的 Technical 依据实际代码形成、Plan 经 iclaude 评审后落实。只因额度耗尽改用新 subagent。自动验收使用专用目录，网页使用 Playwright；物理远端条件缺失则如实保留缺口，Mac 双架构产物照常构建。既有在线 Hub 的部署更新不随开发自动执行。

身份/空间的完整独立 API 和 Web 流程已验收归档。HAPI 多用户桥接在阶段 2 验证，阶段 1 不把新 token 翻译成原有 root 凭据。全产品默认入口和连接配置在阶段 5–7 切换，避免让一个尚不完整的授权模型接管现有执行。
