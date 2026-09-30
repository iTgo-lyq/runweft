# 仓库与中心 Agent 验收

> 2026-10-01。按用户与 AGENTS.md 对本地自动验收的既有授权完成；本阶段是独立领域组件，默认委派和 Web 配置切换仍在后续 Change。

## 需求对应

| 需求 | 已验证结果 | 证据 |
| --- | --- | --- |
| Repository 稳定 ID、remote/明确别名、clone/worktree | 同 clone 共用 commonDir 关联，跨 clone 通过空间别名匹配；fork/多 remote 不静默合并，漂移要求 bind；含凭据地址本机脱敏，不作为授权 | hub-repositories.test、编译 CLI、真实 Git/native 组合 smoke |
| 中心 Agent 归属、版本、作用仓库、分享与治理 | 同名不同 owner 独立；条件写只允许一个版本胜出；共享不授编辑/历史权，私有管理员只见摘要；治理不因编辑/登记清除 | hub-agents.test、CLI 并发 CAS、治理 smoke |
| 本人选择及 Agent/runtime 授权交集 | user/space/可空 repo 唯一；显式/仓库/空间顺序、同 Agent runtime override；失效保留且不回退；成员移除同事务清理选择/checkout/成员授权并撤回 owned Agent 分享 | hub-agent-resolution.test、成员重入 smoke |
| 固定版本、来源、目标与不可用原因 | 不可变内容行和解析 JSON，探测时间不改变配置版本；7 类探测期间变更拒绝旧结果；两个 runtime 原生参数映射复用 | resolution/races/旧 agent-targets 测试，原生 Codex/Claude 探测 |

## 实际验证

- T3 最终生产代码：typecheck/build 通过，全仓 230 pass、0 fail、4724 expectations、34 文件（`.dev-smoke/reviews/hub-repository-agents/t3-tests.log`）。T4 仅新增 smoke、命令入口与交付文档，没有修改生产代码；在该结果基础上再次 typecheck 并编译/执行新 smoke。
- 编译 `.dev-smoke/reviews/hub-repository-agents/configuration-smoke`，使用实际 dist/runweft/dist/hapi，独立 Hub/Runner、两个用户和管理员、真实 Git clone/worktree：6 组通过。证据 `.dev-smoke/hub-configuration-pF0Xrp/evidence.json` 与 `t4-native.log`。
- 原生版本实际检测为 Codex 0.159.2、Claude Code 2.1.283。验证原生工具探测、Hub/Runner 重启后选择稳定、两用户私有同名定义、授权交集和治理、版本留存、remote 漂移与成员重入、日志无凭据。没有模型或任务执行；数据库没有新 task/session。
- HAPI 子模块未修改，使用既有 0.30.7 / protocol 1。所有测试使用专用目录，在线 Hub、用户 MCP/模型配置未改动；相关子进程已清理。

## 交付边界

默认 CLI 根级 Agent 文件路径、旧 namespace 资源/任务与 serve 仍保留，以便阶段 5 显式迁移。配置预览本身不启动子 agent，不证明模型登录/模型兼容或物理远端执行。Web Agent/仓库管理、产品 Skill、默认接入和完整平台发行由后续阶段完成，本阶段没有需要用户手工验收的缺口。

下游接入见 [消费者契约](consumer-contract.md)，权限与当前代码以通过验收后同步的 Specs 为准。
