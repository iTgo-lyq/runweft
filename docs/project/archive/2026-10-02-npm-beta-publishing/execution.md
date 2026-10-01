# npm Beta tag 发布执行概况

## T1 实现通道与稳定保护

- iclaude：Plan 只读会话 c7caebea-de42-4016-a0aa-7f3611693602，成功完成，无额度耗尽或委派。按 Plan 的独立判断采纳跨 beta/latest 前进、实际标签验证、可测试参数/共用门禁、开发分支官网跳过和证据范围；不增加旧 run 回执兼容或修改版本/包内说明/Skill。
- 结果：共享规范 stable/Beta 解析与数值比较，参数由包版本选择 latest/beta；正式回执保留 channel、latestBefore 和实际 distTags。Beta 同时前进 beta/latest，保持恢复原基线；实际 latest 变化报错不自动修复，版本/标签传播仅等待不重上传。CLI 门禁移到 Node 24 后使用同一函数。
- 官网：仅 codex push/dispatch 的 Beta 明确跳过构建、准备/上传和静态产物；main/PR 的 Beta 失败。聚焦测试使用专用稳定项目，避免 Beta checkout 在跳过前被测试内的真实稳定构建阻塞；真实 builder 仍只接受稳定版本。
- 验证：typecheck、274 项根测试全部通过（5391 断言、43 文件、零跳过/失败）；17 项发布测试包含通道/参数、数值序号、跨通道/部分恢复、未知状态与实际 latest 变化。14 项官网测试在稳定与专用 Beta 源版本环境均通过；actionlint 通过。实际 npm 11.19.0 的 --tag=beta --dry-run 在专用最小包夹具通过，published=false，不是正式候选或真实 Beta 上传。
- 环境：独立工作区补齐已有 HAPI 工作区依赖链接后根检查通过；原工作区审计与用户配置保持不动。包输入与 v1.1.1 无差异，历史交付不变。稳定归档文档的追加 Pages run 36920246993 已成功。
- Commit：`npm-beta-publishing T1: add beta channel and protect stable releases`

## T2 文档与真实工作流预演

- 结果：492bda5bbc1a4b5befe16215347b4cbd1843f14e 已推送 main；CLI 36921038282、npm 36921038560 和 Pages 36921038133 全部成功。两个独立四平台候选/安装检查通过，五包 OIDC HTTP 201；原 npm 回执 source=492bda5、version=1.1.1、channel=latest、success=true、published=false。
- 验证：npm 候选根 CI 272 pass、2 skip、0 fail、5369 断言、43 文件，两项跳过因托管 runner 无 Codex CLI。Pages eligibility 为稳定版本 build=true，生产唯一 URL https://08c3e5b5.runweft.pages.dev/；唯一 URL/正式域名八文件 hash/MIME 匹配，91,064 bytes，内容与已验收 1.1.1 完全相同。五包公开完整性/latest=1.1.1 保持、均无 beta tag。
- 文档：补充独立开发分支、规范版本、同名 tag、Beta 安装、稳定转正和原候选/通道恢复步骤；明确仅开发分支跳过官网。此轮没有实际 Beta tag，Beta 门禁、参数 dry-run 与官网跳过均为专用本地夹具证据，main 真实 CI 只验证稳定路径。
- Commit：`npm-beta-publishing T2: document and verify trusted release workflow`

## T3 自动验收、Specs 同步与归档

- 结果：用户持续授权下自动验收，需求映射配置、聚焦夹具与真实稳定 CI；同步发行/验收/官网 Specs 和项目入口，完整归档，不修改历史。文档追加 production run 36922124955 成功，原回执与唯一/正式域名八文件再次一致。
- 验证：Change 结构、文档链接、git diff 与原 tag 包输入检查通过，任务提交推送 main；独立工作区干净，原工作区审计改动保留。验收明确 Beta 全候选/实际 tag/upload 与新版正式标签回执尚未真实执行。
- Commit：`npm-beta-publishing T3: sync verified workflow specs and archive`
