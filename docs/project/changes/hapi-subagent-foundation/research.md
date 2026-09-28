# HAPI 复用与项目重建依据

> 调查日期：2026-09-28
> 用途：区分上游事实、旧实现与新项目决策；不代替需求或技术方案。

## 仓库起点

旧 Runweft 主分支快照为 `0cbfa01f522488b2ede60e47adc1117698b54748`。新仓库独立初始化，仅迁入项目工作流并清除其不存在的委派 skill 依赖；不迁入旧应用代码、运行数据、HAPI 补丁、锁文件或认证产物。

旧仓库的三个 review 分支已保存在 GitHub 存档，其改动已以等价提交进入旧主分支；本地 review 工作区已清理。隐私验证副本的试验差异和恢复基线保存在存档 checkout 的 `.dev-smoke/review-worktree-snapshots/`，未上传，也不进入新项目。

## 已核对的 HAPI 能力

调查对象是旧仓库锁定的 HAPI `0.30.7`，提交 `2f72a8012ebe8632eb6a7ac697264ba970e7edde`。这是历史证据锚点，不是新项目已选择的依赖版本。

| 事实 | 一手证据 | 对需求的影响 |
| --- | --- | --- |
| CLI 和 Hub 使用 TypeScript / Bun | [CLI package](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/package.json)、[Hub package](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/hub/package.json) | 扩展成本主要来自接口和生命周期耦合，不能归因于 Go |
| 有通用 backend 和 ACP 复用层 | [AgentBackend](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/src/agent/types.ts)、[DSH backend](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/src/dsh/utils/dshBackend.ts) | 新 runtime 可按现有源码结构接入并复用公共组件 |
| runtime 在命令、共享类型和 Runner 中静态注册 | [命令](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/src/commands/registry.ts)、[类型](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/shared/src/modes.ts)、[Runner](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/src/runner/run.ts) | 当前采用源码内扩展，不宣称已有动态插件加载 |
| 原生恢复依赖各 runtime 的实现 | [DSH 会话](https://github.com/tiann/hapi/blob/2f72a8012ebe8632eb6a7ac697264ba970e7edde/cli/src/dsh/session.ts) | 接入协议成功不代表自动具备历史恢复或可靠任务终态 |
| 旧 Runweft 为可靠执行增加了 managed-v1 补丁 | [旧集成说明](https://github.com/iTgo-lyq/runweft-archive/blob/0cbfa01f522488b2ede60e47adc1117698b54748/integrations/hapi/README.md) | 后续逐项评估所需语义，不整体继承补丁与认证模型 |

HAPI 的本地/远程交互模式不直接等价于本项目的同机/跨主机执行目标；跨主机文件准备与 Git 结果取回必须单独验证。

## 社区插件提案跟踪

| 材料 | 核对结果 |
| --- | --- |
| [Issue #653](https://github.com/tiann/hapi/issues/653) | 2026-05-20 提出；维护者作出积极回应；2026-05-27 由作者关闭 |
| [PR #689](https://github.com/tiann/hapi/pull/689) | 同一作者提交的插件实现，关闭且未合并 |
| [PR #695](https://github.com/tiann/hapi/pull/695) | 包含插件 runtime、管理与 marketplace；2026-05-29 由作者关闭，未合并 |

作者的 [关闭留言](https://github.com/tiann/hapi/pull/695#issuecomment-4569605561)仅表示暂时关闭草稿，没有给出技术或维护方面的原因。不能据此推断方案被维护者拒绝或已验证不可行。

本项目决策是继续源码内扩展。后续相关调研可复查这些入口；不安装、不移植这些 PR，也未设置自动监控。若上游方向改变，先评估其对现有职责边界的影响。
