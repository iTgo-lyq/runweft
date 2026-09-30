# Runweft

将 HAPI 的执行能力适配为 Codex 和 Claude Code 可调用的 MCP subagent 工具。

本仓库从新的 Git 历史开始，正在按阶段实现完整产品。目前支持统一 CLI、本地/Hub 部署、全局 MCP 安装、机器/runtime 登记、Agent 定义、本机共享目录/独立 worktree 协作及任务附件；远端 worktree 委派、代码成果回收和显式留存清理已通过同机多 Runner 验收。协作看板已通过 Playwright 与安装验收；真实跨物理机器与最终发行仍分别记录。旧实现保留在 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)，不继承其功能完成度或认证结论。

从 [项目文档](docs/README.md) 阅读已确认的架构决策、当前 Specs 与后续需求。后续开发使用仓库内的 [project-workflow](.agents/skills/project-workflow/SKILL.md)。

安装、配置、本地/Hub 部署与数据维护见[使用说明](docs/usage.md)。1.0.0 发行集成正在验收，产物覆盖 macOS/Linux arm64/x64；尚未上传公共 npm，可直接解包对应平台产物。Mac 实机由用户验证，真实物理跨机结果单独记录。

源码构建、打包和自动验收见[开发说明](docs/development.md)。开发使用 Bun 1.4.2，需先初始化 submodule 并安装 root/HAPI 两处依赖，再运行类型检查和构建。

通用 HAPI fork 位于 [iTgo-lyq/hapi](https://github.com/iTgo-lyq/hapi)，本仓库通过 [`hapi/`](hapi/) Git submodule 固定其版本。克隆本仓库后运行 `git submodule update --init hapi` 获取源码；HAPI 的修改与提交在 fork 仓库中进行。

文档检查（将 CHANGE_NAME 替换为实际 Change 目录名）：

```sh
bun .agents/skills/project-workflow/scripts/validate-change.mjs docs/project/changes/CHANGE_NAME
git diff --check
```
