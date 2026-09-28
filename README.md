# Runweft

将 HAPI 的执行能力适配为 Codex 和 Claude Code 可调用的 MCP subagent 工具。

本仓库从新的 Git 历史开始，正在按阶段实现完整产品。目前已有配置、工作区绑定、双模式 HAPI 服务管理及候选 npm 平台包；MCP 与任务协作尚未交付。旧实现保留在 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)，不继承其功能完成度或认证结论。

从 [项目文档](docs/README.md) 阅读已确认的架构决策与初始需求规格。后续开发使用仓库内的 [project-workflow](.agents/skills/project-workflow/SKILL.md)。

安装、配置、本地/Hub 部署、数据维护和源码构建见[使用说明](docs/usage.md)。候选包尚未公开发布；当前验证状态见各 Change 的执行记录。

开发环境使用 Bun：`bun install --frozen-lockfile`，然后 `bun run build:hapi` 和 `bun run build`。入口为 `dist/runweft`；`bun run test:service` 验证真实服务，`bun run package --all` 生成平台包，`bun run test:install` 验证 npm 安装。

通用 HAPI fork 位于 [iTgo-lyq/hapi](https://github.com/iTgo-lyq/hapi)，本仓库通过 [`hapi/`](hapi/) Git submodule 固定其版本。克隆本仓库后运行 `git submodule update --init hapi` 获取源码；HAPI 的修改与提交在 fork 仓库中进行。

文档检查：

```sh
bun .agents/skills/project-workflow/scripts/validate-change.mjs docs/project/changes/hapi-subagent-foundation
git diff --check
```
