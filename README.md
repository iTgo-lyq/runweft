# Runweft

让 Codex 和 Claude Code 通过 MCP 委派任务，以 HAPI 内置执行能力运行子会话。

1.1.0 使用明确 Hub、独立用户身份、空间成员权限和中心 Agent 配置。用户通过对话与产品 Skill 完成安装、连接和维护，在 `/hub` 管理机器、runtime、Agent、仓库、个人选择及本人任务；不在项目里维护 Runweft YAML，也不向模型提供身份 token。

支持本机共享目录、本机或远端独立 worktree、附件、代码 bundle 取回、停止和续接。每轮关闭子进程，保留 session 与工作区；只有原生确认历史缺失才重建上下文，未知执行不盲目重发。代码接纳与冲突处理由主 Agent 决定，不自动 push 或合入。

从[产品 Skill](skills/runweft/SKILL.md)和[使用说明](docs/usage.md)接入。发行提供 macOS/Linux arm64/x64 平台包、相邻 HAPI、Skill、说明和校验索引，无需全局 Bun、Node 或另装 HAPI。尚未公开 npm 发布；真实产物及验收状态见[项目入口](docs/README.md)，不要用旧 1.0.0 的验证代替新候选。Mac 实机与物理跨机、Linux arm64 QEMU 与原生协作分别记录。

从[项目文档](docs/README.md)阅读架构决策、当前 Specs 和全部归档；后续开发沿 [project-workflow](.agents/skills/project-workflow/SKILL.md)。旧实现保留在 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)，本仓库使用新的 Git 历史。

产品官网包含介绍、四平台下载与上手指南，源码及静态部署见[官网说明](website/README.md)。已有发行产物时，运行 `node website/build.mjs` 和 `node website/serve.mjs` 可在本机预览。

源码构建、打包和自动验收见[开发说明](docs/development.md)。开发使用 Bun 1.4.2，需先初始化 submodule 并安装 root/HAPI 两处依赖，再运行类型检查和构建。

通用 HAPI fork 位于 [iTgo-lyq/hapi](https://github.com/iTgo-lyq/hapi)，本仓库通过 [`hapi/`](hapi/) Git submodule 固定其版本。克隆本仓库后运行 `git submodule update --init hapi` 获取源码；HAPI 的修改与提交在 fork 仓库中进行。

文档检查（将 CHANGE_NAME 替换为实际 Change 目录名）：

```sh
bun .agents/skills/project-workflow/scripts/validate-change.mjs docs/project/changes/CHANGE_NAME
git diff --check
```
