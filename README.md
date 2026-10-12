# Runweft

让 Codex 和 Claude Code 通过 MCP 委派任务，以 HAPI 内置执行能力运行子会话。

1.1.4 使用明确 Hub、独立用户身份、空间成员权限和中心 Agent 配置。用户通过对话与产品 Skill 完成安装、连接和维护，在 `/hub` 管理机器、runtime、Agent、仓库、个人选择及本人任务；不在项目里维护 Runweft YAML，也不向模型提供身份 token。

支持本机共享目录、本机或远端独立 worktree、附件、代码 bundle 取回、停止和续接。每轮关闭子进程，保留 session 与工作区；只有原生确认历史缺失才重建上下文，未知执行不盲目重发。代码接纳与冲突处理由主 Agent 决定，不自动 push 或合入。

从[产品 Skill](skills/runweft/SKILL.md)和[使用说明](docs/usage.md)接入。[runweft@1.1.4](https://www.npmjs.com/package/runweft/v/1.1.4) 使用 Node.js 20+ 从公共 npm 安装：

```sh
npm install -g runweft@1.1.4 --registry=https://registry.npmjs.org/ --include=optional &&
runweft --version
```

npm 自动选择 macOS/Linux arm64/x64 对应平台包，附带相邻 HAPI、Skill 和说明，无需全局 Bun 或另装 HAPI。平台 tarball 也可直接解包运行，无需 Node。发行与真实验收范围见[项目入口](docs/README.md)；Mac 实机与物理跨机、Linux arm64 QEMU 与原生协作分别记录。

从[项目文档](docs/README.md)阅读当前 Specs、开发入口和历史归档；开发约束见 [AGENTS.md](AGENTS.md)，工作流沿 [SpecTrail](.agents/skills/spec-trail/SKILL.md)。旧实现保留在 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)，本仓库使用新的 Git 历史。

产品官网 [runweft.pages.dev](https://runweft.pages.dev/)包含介绍、统一 npm 安装与上手指南，Skill 随 npm 包提供。main 的官网相关推送由 GitHub Actions 自动部署生产，codex 分支部署预览；配置和验收见[官网说明](website/README.md)。无需准备发行产物，运行 `node website/build.mjs` 和 `node website/serve.mjs` 可在本机预览。

源码构建、打包和自动验收见[开发说明](docs/development.md)。开发使用 Bun 1.4.2，需先初始化 submodule 并安装 root/HAPI 两处依赖，再运行类型检查和构建。

通用 HAPI fork 位于 [iTgo-lyq/hapi](https://github.com/iTgo-lyq/hapi)，本仓库通过 [`hapi/`](hapi/) Git submodule 固定其版本。克隆本仓库后运行 `git submodule update --init hapi` 获取源码；HAPI 的修改与提交在 fork 仓库中进行。

工作流与差异检查：

```sh
node scripts/check-workflow.mjs
git diff --check
```
