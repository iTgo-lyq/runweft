# npm 可信发布

> 更新：2026-10-01

## 目标与范围

用户已要求代为配置可信发布：为 Runweft 五个 npm 包绑定 GitHub Actions，使后续正式版本通过 OIDC 发布，无需逐包人工发布验证。方案、Plan 与本地自动验收沿用 AGENTS.md 的持续授权。

本次交付发布流程、五包信任关系和真实 CI 授权验证；不增加产品版本，不重发已经存在的 1.1.0，不更改仓库可见性或将整个开发分支合入 main。

## 行为变化

### ADDED

- `release/distribution` — 可信发布：正式版本标签触发已验证候选的五包发布；平台公开确认后发布主包，同版本冲突和未知上传结果清楚停止。
- `release/distribution` — 授权检查：普通分支变更运行发布预演及五包 OIDC 交换检查，证明 npm 接受当前工作流，无公开上传。

## 验收标准

- 发布流程和候选完整性、版本标签、部分发布恢复的验证通过；普通分支执行不会上传。
- 五包绑定 `iTgo-lyq/runweft` 的 `npm-publish.yml`，允许直接发布；保留其他已有绑定。
- GitHub 托管 runner 中五包 OIDC 交换成功，CI 候选构建、预演通过；结果不扩张为新版本真实上传。

## 约束与依赖

当前五包已公开发布 1.1.0，仓库默认 main 只有早期文档，已验收产品在 codex/cli-foundation。用户本人须完成 npm 登录/通行密钥认证；不在聊天索取秘密或存储长期发布 token。

## 协作资源

- [npm 可信发布](https://docs.npmjs.com/trusted-publishers/)（2026-10-01）：GitHub 托管 runner、工作流文件与每包绑定，明确允许 npm publish。
- [npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/)（2026-10-01）：官方 CLI 可配置；首次额外认证可选择五分钟免重复验证。
- [npm Registry API](https://api-docs.npmjs.com/)（2026-10-01）：提供每包 OIDC 交换和可信发布配置的权限契约；新增已有绑定会返回冲突，不覆盖历史设置。
- [GitHub 手动工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)（2026-10-01）：workflow_dispatch 依赖默认分支，当前使用版本标签触发，不为此合入整个产品。
