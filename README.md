# Runweft

将 HAPI 的执行能力适配为 Codex 和 Claude Code 可调用的 MCP subagent 工具。

1.0.0 已完成十二个 Change 的实现与集成验收：统一 CLI、本地/Hub 部署、全局 MCP 安装、机器/runtime 登记、全局/项目 Agent 定义、本机共享目录或独立 worktree、远端独立 worktree、任务附件、代码取回与全局协作看板。每轮结束关闭子进程，保留 session 与工作区供后续委派；合入与冲突处理由主 agent 决定。

从[使用说明](docs/usage.md)安装、接入 MCP 和配置本地/Hub 模式。macOS/Linux arm64/x64 产物已一并构建，尚未上传公共 npm，可直接解包对应平台产物；产物位置、校验和及完整证据见[交付验收](docs/project/archive/2026-09-30-integrated-release/acceptance.md)。

Linux x64 已完成真实安装、两宿主 × 两 runtime 的完整协作、Playwright 和升级回退验证。Mac 实机由用户验证；Linux arm64 当前为 QEMU CLI/配置验证；物理远端延期，已通过同机独立 Hub/多 Runner 链路。具体限制与模型环境见交付验收。

从[项目文档](docs/README.md)阅读架构决策、当前 Specs 和全部归档；后续开发沿 [project-workflow](.agents/skills/project-workflow/SKILL.md)。旧实现保留在 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)，本仓库使用新的 Git 历史。

产品官网包含介绍、四平台下载与上手指南，源码及静态部署见[官网说明](website/README.md)。已有发行产物时，运行 `node website/build.mjs` 和 `node website/serve.mjs` 可在本机预览。

源码构建、打包和自动验收见[开发说明](docs/development.md)。开发使用 Bun 1.4.2，需先初始化 submodule 并安装 root/HAPI 两处依赖，再运行类型检查和构建。

通用 HAPI fork 位于 [iTgo-lyq/hapi](https://github.com/iTgo-lyq/hapi)，本仓库通过 [`hapi/`](hapi/) Git submodule 固定其版本。克隆本仓库后运行 `git submodule update --init hapi` 获取源码；HAPI 的修改与提交在 fork 仓库中进行。

文档检查（将 CHANGE_NAME 替换为实际 Change 目录名）：

```sh
bun .agents/skills/project-workflow/scripts/validate-change.mjs docs/project/changes/CHANGE_NAME
git diff --check
```
