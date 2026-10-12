# Runweft 开发约定

## 架构与数据

- Runweft 负责 MCP 适配与委派调度，执行基础复用 HAPI。业务编排与 Agent 选择由主 Agent / 业务 Skill 决定，Runweft 不构建自动业务编排器。
- 接入和执行只支持 Codex / Claude Code，复用 HAPI 内置适配、会话、状态、恢复、审批、文件和 UI。新增能力先核对 HAPI 接口与实现、复现定位具体缺口；不预设改造 launcher、原生协议或执行逻辑，不另建通用 runtime 协议与执行框架。
- HAPI 通过 `hapi/` submodule 固定版本，修改在[独立 fork](https://github.com/iTgo-lyq/hapi)提交；通用改造与内部 runtime 接入分别维护。本仓库不保存 fork 源码或旧补丁流水线；内部 runtime 按 HAPI 原有方式在 fork 源码接入，不做 npm/路径插件，扩展及社区插件 PR 不作为内置 runtime 复用的前置。
- 自有数据只支持当前格式，旧、未知、损坏格式明确拒绝并保留原文件，不做旧记录兼容、补写或自动清理；保留当前业务恢复与显式留存操作。后续升级在对应 Change 从[首次部署基线](docs/project/specs/deployment/spec.md#当前数据格式)明确处理和验证，不预建迁移框架；外部 HAPI 数据由 HAPI 负责。历史测试环境的单次清理授权不成为产品自动清理行为。

## 源码准备与检查

使用 package.json 固定的 Bun（当前 1.4.2）和 HAPI pin。首次准备：

```sh
git submodule update --init hapi
bun install --frozen-lockfile
(cd hapi && bun install --frozen-lockfile)
git config --local core.hooksPath .githooks
bun run build:hapi
```

同仓库 worktree 共用 hook 配置；`node .agents/skills/spec-trail/setup/scripts/check-setup.mjs .` 只查准备条件，hook 须由实际提交验证。HAPI pin 改变后重跑 build:hapi；构建会核对 revision、源码干净和程序 hash。

按改动选择检查，不声称未执行的验证通过：

```sh
bun run typecheck
bun run test
bun run build
node --test ./scripts/tests/*.test.mjs ./website/publish.test.mjs
node scripts/check-docs.mjs
node scripts/check-workflow.mjs
git diff --check
```

根测试显式运行 `./test`，不执行 HAPI 全套测试；Node 测试单独运行。集成与模型验收按[发行验收](docs/project/specs/release/acceptance/spec.md)选择，失败先诊断、定向续验，不自动整组重试。

## 验证边界与按需入口

- 不自动修改用户 Codex / Claude Code 配置、HAPI 数据或模型凭据。接入由显式 CLI 辅助安装/更新/卸载，开发验收使用专用 `HOME`、`CODEX_HOME`、`CLAUDE_CONFIG_DIR`，保留其他 MCP 和原生配置；真实模型验收须已有授权。
- 产品 Skill 在 `skills/runweft/`，只交付、不安装到开发者全局；修改后做结构校验和独立 Agent 场景验收。网页使用 Playwright 自动验收，无需用户真实浏览器。
- MCP stdout 只输出协议，日志走 stderr；不记录凭据、完整 prompt 或用户源码。区分真实验证、文档证据和推断，结果未知时不推断成功、不盲目重发。
- 临时文件放 `.dev-smoke/`，不提交；搜索默认排除 `node_modules/`、`dist/` 和历史归档。
- 打包与发布按[发行操作](docs/release.md)，官网按 [website/README](website/README.md)。独立原型按 [包内说明](packages/prototype/README.md)、AGENTS.md 与 DESIGN.md，使用内存示例并登记 SpecTrail 固定发布引用。
