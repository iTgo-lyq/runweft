# 仓库关联与中心 Agent 配置

> 状态：已确认
> 规模：大型
> 前置：[身份与空间](../hub-identities-and-spaces/requirement.md)、[资源归属](../hub-resource-ownership/requirement.md)
> 更新：2026-09-30

## 目标与行为

Hub 持有跨仓库和仓库级 Agent 定义及个人选择；同仓库的不同用户可维护独立配置，不依赖仓库内 YAML。

### ADDED / MODIFIED

- Repository 稳定 ID、Git remote 规范身份/明确别名及 clone/worktree 关联；fork、不同 host/path 不误合并，自报 URL 不授权。
- Agent 稳定 ID、owner、space、职责/参数、runtime 引用、仓库适用范围、版本；仅自己/指定成员/空间成员，私有配置仅所有者改写和分享，管理员可禁用。
- 用户 × 空间 × 可选仓库的个人选择；显式选择优先，不按同名项静默替换。共享 Agent 与 runtime 使用权取交集。
- 解析返回中心配置版本、来源、目标及不可用原因；任务采用不可变快照，后续编辑不改历史。

## 验收与边界

同仓库跨 clone/worktree、两用户同名 Agent、fork/多 remote、个人偏好、管理员禁用和 runtime 权限交集均验证。仅提供业务 Agent 参数，不集中管理工程 skill/MCP；原生配置沿执行 cwd 继承。移除旧文件权威路径和显式导入归委派迁移 Change。
