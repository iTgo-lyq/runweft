# 项目文档

开发流程已接入 [SpecTrail](../.agents/skills/spec-trail/SKILL.md)。[独立 Hub 交互原型](../packages/prototype/README.md)包含 8 个入口和三设备视图，工作台读取 `workflow.json`、Change 状态与固定原型清单。

[发布流程提速](https://github.com/iTgo-lyq/runweft/tree/codex/release-throughput/docs/project/changes/release-throughput)保存在独立规划分支，继续按 2026-10-12 用户要求暂缓实施。调研、方案草稿和评审结论完整保留；恢复需用户明确提出。

[Runweft 1.1.4 发布验收](project/archive/2026-10-12-npm-uninstall-release/acceptance.md)已完成：全部代码合入 main，五包先beta、四平台实际公共安装与完整卸载通过后晋级latest，匿名五包摘要和Linux程序/Skill核对通过。[正式官网](https://runweft.pages.dev/)同步1.1.4；十文件摘要/MIME及三页浏览器通过。发布、安装与官网不依赖Actions artifact；失败及恢复证据见同一归档。

[一键完整卸载](project/archive/2026-10-12-complete-uninstall/acceptance.md)已完成源码实现与自动验收：根级 uninstall 默认预览，--yes 停止选定 home 的全部受管服务/登记会话并删除程序、接入、数据和备份，保留其他软件、模型凭据、原生历史及源项目。260 项根测试和 Linux x64 真实 npm/独立包闭环通过；已随公共 1.1.4 发布，并追加四平台验收。

[官网会话介绍布局](project/archive/2026-10-12-website-compact-session-preview/acceptance.md)已更新：[截图预览](https://runweft.pages.dev/#session-screenshots)融入会话介绍块，桌面与手机都采用小尺寸双图并排，去掉说明与来源标注。iclaude 重写该块文案；三页六宽度、完整原图访问及线上十文件检查通过。

[官网原生执行与 HAPI 能力说明](project/archive/2026-10-12-website-hapi-capabilities/acceptance.md)已上线：[首页新增内容](https://runweft.pages.dev/#native-experience)、[会话与审批指南](https://runweft.pages.dev/guide.html#native-session)。文案由 iclaude 完成，说明原生配置、会话历史、浏览器审批/文件及手机访问条件；保留首屏、样式和 npm 1.1.3。

[官网内容更新](project/archive/2026-10-12-website-content-onboarding/acceptance.md)已上线：[首页](https://runweft.pages.dev/)与[上手指南](https://runweft.pages.dev/guide.html)的改写文案由 iclaude 完成，接入和重开后的首项委派分开说明。既有样式与 npm 1.1.3 保留，三页浏览器、八文件摘要及 main/Pages CI 通过。

此前Runweft 1.1.3已由不可变v1.1.3源码通过beta上传、四平台公共npm安装验收和OIDC latest晋级；五包匿名下载/摘要、Linux x64 DOM安装及Skill核对通过，固定HAPI 8f774b94包含已验收的[Claude长路径与Runner退出修复](project/archive/2026-10-10-hapi-session-and-shutdown/acceptance.md)。发布/核心/官网均不依赖Actions artifact。main CI、生产官网1.1.3部署与正式域名八文件/三页验收通过，1.1.2 beta未晋级，修正Mac校验的1.1.3为当时正式版本；来源和范围见[发布验收](project/archive/2026-10-11-npm-hapi-fix-release/acceptance.md)。

Runweft 1.1.4 已发布；产品已完成 Hub 集中配置七阶段、完整后台/Skill与同候选集成发行。安装、配置、部署与数据维护见[使用说明](usage.md)，源码构建和验证见[开发说明](development.md)。

[当前数据基线与本机测试环境清理](project/archive/2026-10-10-current-data-baseline/execution.md)已完成。用户确认截至2026-10-10尚未在其他机器部署，数据库和本地配置以当前源码结构为首次部署基线，历史测试格式迁移不作为发行前提。本机16个历史测试目录已删除；原始临时现场不再保留，已跟踪的验收说明和脱敏摘要、源码及正式交付保留。

[Hub 空间、身份与集中 Agent 配置](project/archive/2026-10-01-hub-spaces-and-agent-configuration/requirement.md)已按[七阶段交付](project/archive/2026-10-01-hub-spaces-and-agent-configuration/delivery.md)完成：独立身份/空间、HAPI对象授权、机器/runtime所有权、仓库/中心Agent、必连Hub委派、后台/Skill及最终发行。用户通过Agent/Skill操作、Web维护配置与任务；共享限空间成员，管理员不取得他人私有内容。产品设计和研究保存在同一归档，当前事实以Specs为准。

完整交付为 `dist/runweft-1.1.0-release/`、`dist/runweft-1.1.0-release.tar.gz` 及 `.sha256`：四平台/主包、Skill、静态官网、对应源码/离线Git bundle、可读验收和脱敏证据。Linux x64真实安装通过十二组原生MCP、十组消费者、后台/连接Playwright、升级与清理；256项根测试通过。具体hash、位置及边界见[1.1.0完整验收](project/archive/2026-10-01-hub-spaces-and-agent-configuration/acceptance.md)。原离线候选保留不覆盖；公共 npm 五包现已发布，匿名下载和 Linux x64 专用安装通过，见[npm 发布验收](project/archive/2026-10-01-npm-publication/acceptance.md)。官网现已部署生产与分支预览。

[原版最终交付验收](project/archive/2026-09-30-integrated-release/acceptance.md)汇总当时的四平台产物、校验和、需求对应及原始证据。Linux x64 完成真实安装、20 组核心协作、8 组附件、2 组 MCP 控制、原生历史重建、升级回退和 Playwright；Mac 实机由用户验证，Linux arm64 为 QEMU CLI/配置验证，物理远端延期。远端功能已通过同机独立 Hub/多 Runner 真实链路。早期四平台基础安装证据不代替最终原生协作。

实现以当前 HAPI 为第一依据，Runweft 尽量只做上层流程封装与 MCP；旧工程技术方案不直接沿用。

已交付整体方案与各归档 Change 均完成 iclaude 辅助评审；[整体复核记录](project/architecture-review.md)和各归档的 Execution 保存采纳依据。模块分工与依赖见[项目架构](project/architecture.md)。

核心重构按[六阶段交付结构](project/delivery-structure.md)完成十一个领域 Change 和一个集成发行 Change；当前事实见 Specs，历史需求和验收见下列归档。

产品官网已统一为 npm 安装，Skill 从 npm 包内接入；静态构建无下载归档，实际 DOM 命令安装与网页自动验收通过，见[本次验收](project/archive/2026-10-02-website-npm-installation/acceptance.md)。已部署[正式官网](https://runweft.pages.dev/)与 [Cloudflare 分支预览](https://codex-cli-foundation.runweft.pages.dev/)；构建与预览见[官网说明](../website/README.md)。

[Cloudflare Pages 自动部署](project/archive/2026-10-02-website-cloudflare-pages/acceptance.md)已完成 codex 分支预览：两个 Repository secrets、项目创建、真实上传及三页/资源自动校验通过。产品现已快进合入 main，[生产部署 CI](https://github.com/iTgo-lyq/runweft/actions/runs/36912561909)、正式域名八文件摘要/MIME 与三页 Playwright 检查通过；手动和 PR 的真实触发仍未实测。npm 正式发布由匹配源码版本的 tag 触发：稳定版先beta、四平台验收后latest，X.Y.Z-beta.N验收后保持beta。

1.1.1 已通过稳定 tag/OIDC 真实上传，公共五包 latest=1.1.1；四平台托管安装、匿名 Linux x64 DOM 安装与当前 npm Skill 核对通过。main 的 CLI/Pages 及正式域名三页、八文件摘要/MIME 检查通过，见[补丁发布验收](project/archive/2026-10-02-npm-patch-release/acceptance.md)。历史离线 1.1.0 整包与分支预览保留，未追加模型或物理跨机验收。Beta tag 通道已配置，原四平台/OIDC 稳定预演通过；首个 X.Y.Z-beta.N 尚未发布，Beta 门禁/参数/官网跳过目前为本地夹具证据，见[配置验收](project/archive/2026-10-02-npm-beta-publishing/acceptance.md)。

已交付 Change 按独立交付结果拆分并声明依赖，归档入口如下：

| Change | 需求入口 | 方案与依据 |
| --- | --- | --- |
| HAPI 内置能力验证与调用封装（已归档） | [Requirement](project/archive/2026-09-29-hapi-subagent-foundation/requirement.md) | [Research](project/archive/2026-09-29-hapi-subagent-foundation/research.md) |
| 统一 CLI 与部署（已归档） | [Requirement](project/archive/2026-09-29-unified-cli-and-deployment/requirement.md) | [Design](project/archive/2026-09-29-unified-cli-and-deployment/design.md) |
| 本地共享委派与生命周期（已归档） | [Requirement](project/archive/2026-09-29-delegation-lifecycle/requirement.md) | [Technical](project/archive/2026-09-29-delegation-lifecycle/technical.md)、[Plan](project/archive/2026-09-29-delegation-lifecycle/plan.md)、[验收](project/archive/2026-09-29-delegation-lifecycle/acceptance.md) |
| 任务附件交付（已归档） | [Requirement](project/archive/2026-09-29-task-artifact-delivery/requirement.md) | [Technical](project/archive/2026-09-29-task-artifact-delivery/technical.md)、[Plan](project/archive/2026-09-29-task-artifact-delivery/plan.md)、[契约](project/archive/2026-09-29-task-artifact-delivery/artifact-contract.md) |
| 远端工作区准备（已归档） | [Requirement](project/archive/2026-09-30-remote-workspace-preparation/requirement.md) | [Technical](project/archive/2026-09-30-remote-workspace-preparation/technical.md)、[Plan](project/archive/2026-09-30-remote-workspace-preparation/plan.md)、[基线契约](project/archive/2026-09-30-remote-workspace-preparation/baseline-contract.md)、[Research](project/archive/2026-09-30-remote-workspace-preparation/research.md) |
| 远端代码回收（已归档） | [Requirement](project/archive/2026-09-30-remote-result-delivery/requirement.md) | [Technical](project/archive/2026-09-30-remote-result-delivery/technical.md)、[Plan](project/archive/2026-09-30-remote-result-delivery/plan.md)、[结果契约](project/archive/2026-09-30-remote-result-delivery/result-contract.md) |
| 宿主身份与 MCP 适配（已归档） | [Requirement](project/archive/2026-09-29-host-mcp-adapter/requirement.md) | [Technical](project/archive/2026-09-29-host-mcp-adapter/technical.md)、[Plan](project/archive/2026-09-29-host-mcp-adapter/plan.md)、[Research](project/archive/2026-09-29-host-mcp-adapter/research.md) |
| 本地独立工作区与公共 Git 能力（已归档） | [Requirement](project/archive/2026-09-29-local-workspace-execution/requirement.md) | [Technical](project/archive/2026-09-29-local-workspace-execution/technical.md)、[验收](project/archive/2026-09-29-local-workspace-execution/acceptance.md) |
| 全局机器与 Runtime 注册（已归档） | [Requirement](project/archive/2026-09-29-execution-resource-registry/requirement.md) | [Technical](project/archive/2026-09-29-execution-resource-registry/technical.md)、[Plan](project/archive/2026-09-29-execution-resource-registry/plan.md)、[Research](project/archive/2026-09-29-execution-resource-registry/research.md) |
| Agent 定义（已归档） | [Requirement](project/archive/2026-09-29-agent-definition/requirement.md) | [Technical](project/archive/2026-09-29-agent-definition/technical.md)、[Plan](project/archive/2026-09-29-agent-definition/plan.md)、[Research](project/archive/2026-09-29-agent-definition/research.md) |
| Subagent 看板（已归档） | [Requirement](project/archive/2026-09-30-subagent-dashboard/requirement.md) | [验收](project/archive/2026-09-30-subagent-dashboard/acceptance.md)、[规格](project/specs/dashboard/subagents/spec.md) |
| HAPI 默认简体中文（已归档） | [Requirement](project/archive/2026-09-30-hapi-default-chinese/requirement.md) | [验收记录](project/archive/2026-09-30-hapi-default-chinese/execution.md)、[规格](project/specs/dashboard/subagents/spec.md) |
| 完整版本集成与发布（已归档） | [Requirement](project/archive/2026-09-30-integrated-release/requirement.md) | [验收](project/archive/2026-09-30-integrated-release/acceptance.md)、[发行规格](project/specs/release/distribution/spec.md)、[验证范围](project/specs/release/acceptance/spec.md) |
| 产品官网（已归档） | [Requirement](project/archive/2026-09-30-product-website/requirement.md) | [验收](project/archive/2026-09-30-product-website/acceptance.md)、[产品与安装](project/specs/website/product/spec.md)、[指南](project/specs/website/guide/spec.md) |
| Hub 委派接入与配置切换（已归档） | [Requirement](project/archive/2026-10-01-hub-delegation-migration/requirement.md) | [验收](project/archive/2026-10-01-hub-delegation-migration/acceptance.md)、[连接交接](project/specs/identity/connection/spec.md)、[中心委派](project/specs/delegation/central/spec.md) |
| Hub 后台与 Skill（已归档） | [Requirement](project/archive/2026-10-01-hub-console-onboarding/requirement.md) | [验收](project/archive/2026-10-01-hub-console-onboarding/acceptance.md)、[后台](project/specs/dashboard/subagents/spec.md)、[Skill](project/specs/installation/skill/spec.md) |
| Hub 集中配置与1.1.0集成发行（已归档） | [Requirement](project/archive/2026-10-01-hub-spaces-and-agent-configuration/requirement.md) | [验收](project/archive/2026-10-01-hub-spaces-and-agent-configuration/acceptance.md)、[执行/整包hash](project/archive/2026-10-01-hub-spaces-and-agent-configuration/execution.md)、[交付拆分](project/archive/2026-10-01-hub-spaces-and-agent-configuration/delivery.md) |
| npm 首次公开发布（已归档） | [Requirement](project/archive/2026-10-01-npm-publication/requirement.md) | [验收/公开包 hash](project/archive/2026-10-01-npm-publication/acceptance.md)、[执行](project/archive/2026-10-01-npm-publication/execution.md)、[发行规格](project/specs/release/distribution/spec.md) |
| npm 可信发布（已归档） | [Requirement](project/archive/2026-10-01-npm-trusted-publishing/requirement.md) | [五包绑定与真实 CI 验收](project/archive/2026-10-01-npm-trusted-publishing/acceptance.md)、[脱敏证据](project/archive/2026-10-01-npm-trusted-publishing/verification.json)、[发版操作](development.md#npm-可信发布) |
| 官网统一 npm 安装（已归档） | [Requirement](project/archive/2026-10-02-website-npm-installation/requirement.md) | [验收](project/archive/2026-10-02-website-npm-installation/acceptance.md)、[产品与安装](project/specs/website/product/spec.md)、[指南](project/specs/website/guide/spec.md) |
| 官网 Cloudflare Pages（已归档） | [Requirement](project/archive/2026-10-02-website-cloudflare-pages/requirement.md) | [真实预览验收](project/archive/2026-10-02-website-cloudflare-pages/acceptance.md)、[脱敏证据](project/archive/2026-10-02-website-cloudflare-pages/verification.json)、[官网规格](project/specs/website/product/spec.md) |
| 模块瘦身（已归档） | [Requirement](project/archive/2026-10-02-module-slimming-audit/requirement.md) | [覆盖表](project/archive/2026-10-02-module-slimming-audit/coverage.md)、[审计清单](project/archive/2026-10-02-module-slimming-audit/research.md)、[验收](project/archive/2026-10-02-module-slimming-audit/acceptance.md)、[证据摘要](project/archive/2026-10-02-module-slimming-audit/verification.json) |
| 1.1.1 npm 正式补丁发布（已归档） | [Requirement](project/archive/2026-10-02-npm-patch-release/requirement.md) | [验收](project/archive/2026-10-02-npm-patch-release/acceptance.md)、[公开包/原候选证据](project/archive/2026-10-02-npm-patch-release/verification.json) |
| npm Beta tag 发布（已归档） | [Requirement](project/archive/2026-10-02-npm-beta-publishing/requirement.md) | [配置验收](project/archive/2026-10-02-npm-beta-publishing/acceptance.md)、[本地/真实 CI 证据](project/archive/2026-10-02-npm-beta-publishing/verification.json)、[操作说明](development.md#npm-可信发布) |

上述归档 Change 均经一次 iclaude Plan 评审、逐任务实现提交、自动本地验收及 Specs 同步后关闭；明确由用户承担或延期的实测范围见最终验收。活跃 Change 的设计草稿不代替正式 Technical 或 Plan，也不修改已验收 Specs。

按照 [SpecTrail](../.agents/skills/spec-trail/SKILL.md)：

- [第二轮测试瘦身](project/archive/2026-10-03-test-backbone-slimming/acceptance.md)已完成并归档：保留领域骨干，收敛四组集成与六原生主链，普通CI复用准备、发布仅构建一份候选；[证据与首次失败](project/archive/2026-10-03-test-backbone-slimming/verification.json)记录248项根测试、33项Node检查、原生专项及定向修正。未执行远端CI或物理跨机验收。
- [模块瘦身](project/archive/2026-10-02-module-slimming-audit/acceptance.md)已完成全模块审计、逐任务实施与同候选本地验收；[覆盖表](project/archive/2026-10-02-module-slimming-audit/coverage.md)与[证据清单](project/archive/2026-10-02-module-slimming-audit/research.md)保留调查依据。Runweft仅支持当前数据格式，不迁移、兼容读取或清理旧数据，已移除data/reset；现行权限与恢复保障保留。此次候选没有发布，未验证平台范围见验收。
- 新的未关闭目标、技术方案和计划放在 `project/changes/`；[npm 可信发布](project/archive/2026-10-01-npm-trusted-publishing/requirement.md)已完成五包绑定、真实四平台 CI/OIDC 与无上传预演。[首次 npm 发布](project/archive/2026-10-01-npm-publication/requirement.md)已完成公共五包、下载/安装验证及发行事实同步并归档；既有依赖见[Hub集中配置交付](project/archive/2026-10-01-hub-spaces-and-agent-configuration/delivery.md)。
- 已验收 Specs：[CLI 安装](project/specs/installation/cli/spec.md)、[MCP 安装](project/specs/installation/mcp/spec.md)、[宿主 MCP](project/specs/host-mcp/spec.md)、[部署与数据](project/specs/deployment/spec.md)、[工作区绑定](project/specs/workspaces/bindings/spec.md)、[执行事实](project/specs/execution/lifecycle/spec.md)、[执行恢复](project/specs/execution/recovery/spec.md)、[执行兼容](project/specs/execution/compatibility/spec.md)、[机器](project/specs/resources/machines/spec.md)、[Runtime](project/specs/resources/runtimes/spec.md)、[资源范围](project/specs/resources/scope/spec.md)、[Agent 定义](project/specs/agents/definition/spec.md)、[来源与绑定](project/specs/agents/scope/spec.md)、[原生继承边界](project/specs/agents/inheritance/spec.md)。
- 已验收协作 Specs：[委派入口](project/specs/delegation/interface/spec.md)、[持久协调](project/specs/delegation/lifecycle/spec.md)、[业务轮次](project/specs/delegation/rounds/spec.md)、[结果与等待](project/specs/delegation/results/spec.md)、[上下文](project/specs/delegation/context/spec.md)、[本机共享工作区](project/specs/local-workspace/shared/spec.md)。
- 已验收附件 Specs：[持久文件](project/specs/artifacts/spec.md)、[启动前输入](project/specs/artifacts/inputs/spec.md)、[输出交付](project/specs/artifacts/delivery/spec.md)、[留存与清理](project/specs/artifacts/retention/spec.md)。
- 已验收独立工作区 Specs：[模式](project/specs/local-workspace/mode/spec.md)、[准备与启动](project/specs/local-workspace/readiness/spec.md)、[成果与留存](project/specs/local-workspace/finish/spec.md)、[机器 Git 生命周期](project/specs/git-workspace/lifecycle/spec.md)。
- 已验收远端准备 Specs：[诊断入口](project/specs/remote-workspace/spec.md)、[固定基线](project/specs/remote-workspace/baseline/spec.md)、[独立环境与留存](project/specs/remote-workspace/isolation/spec.md)、[启动校验](project/specs/remote-workspace/readiness/spec.md)。
- 已验收代码回收 Specs：[固定成果](project/specs/remote-results/snapshot/spec.md)、[中心交付](project/specs/remote-results/delivery/spec.md)、[取回合入](project/specs/remote-results/fetch/spec.md)、[恢复留存](project/specs/remote-results/retention/spec.md)。
- 已验收交付 Specs：[全局看板](project/specs/dashboard/subagents/spec.md)、[发行产物](project/specs/release/distribution/spec.md)、[组合验收范围](project/specs/release/acceptance/spec.md)。
- 已验收官网 Specs：[产品与安装](project/specs/website/product/spec.md)、[使用指南](project/specs/website/guide/spec.md)。
- `project/archive/` 保存已关闭 Change 的完整过程与验收记录。

新仓库不迁入旧实现、旧 Changes 或运行认证。历史证据定位到 [runweft-archive](https://github.com/iTgo-lyq/runweft-archive)。

当前Hub Specs：[身份token](project/specs/identity/tokens/spec.md)、[空间成员](project/specs/spaces/membership/spec.md)、[Web凭据交接](project/specs/identity/connection/spec.md)、[执行授权](project/specs/execution/access/spec.md)、[资源归属](project/specs/resources/ownership/spec.md)、[仓库关联](project/specs/repositories/association/spec.md)、[中心Agent](project/specs/agents/central/spec.md)、[中心委派](project/specs/delegation/central/spec.md)、[后台](project/specs/dashboard/subagents/spec.md)、[产品Skill](project/specs/installation/skill/spec.md)。公共 1.1.0 的 Mac 用户实机、arm64 模型和物理跨机未测；新的可信发布 CI 候选另有四平台原生安装/服务证据，范围见[发行验收](project/specs/release/acceptance/spec.md)。同机 Runner 不替代物理远端。
