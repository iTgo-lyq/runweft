# Runweft

将 HAPI 的执行能力适配为 Codex 和 Claude Code 可调用的 MCP subagent 工具。

本仓库从新的 Git 历史开始，目前仅建立项目工作流、需求规格与 HAPI submodule 关联，尚无可运行的 CLI、MCP 服务或 runtime 接入。旧实现保留在 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)，不继承其功能完成度或认证结论。

从 [项目文档](docs/README.md) 阅读已确认的架构决策与初始需求规格。后续开发使用仓库内的 [project-workflow](.agents/skills/project-workflow/SKILL.md)。

通用 HAPI fork 位于 [iTgo-lyq/hapi](https://github.com/iTgo-lyq/hapi)，本仓库通过 [`hapi/`](hapi/) Git submodule 固定其版本。克隆本仓库后运行 `git submodule update --init hapi` 获取源码；HAPI 的修改与提交在 fork 仓库中进行。

文档检查：

```sh
bun .agents/skills/project-workflow/scripts/validate-change.mjs docs/project/changes/hapi-subagent-foundation
git diff --check
```
