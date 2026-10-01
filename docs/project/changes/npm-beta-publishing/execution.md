# npm Beta tag 发布执行概况

## T1 实现通道与稳定保护

- iclaude：Plan 只读会话 c7caebea-de42-4016-a0aa-7f3611693602，成功完成，无额度耗尽或委派。按 Plan 的独立判断采纳跨 beta/latest 前进、实际标签验证、可测试参数/共用门禁、开发分支官网跳过和证据范围；不增加旧 run 回执兼容或修改版本/包内说明/Skill。
- 结果：共享规范 stable/Beta 解析与数值比较，参数由包版本选择 latest/beta；正式回执保留 channel、latestBefore 和实际 distTags。Beta 同时前进 beta/latest，保持恢复原基线；实际 latest 变化报错不自动修复，版本/标签传播仅等待不重上传。CLI 门禁移到 Node 24 后使用同一函数。
- 官网：仅 codex push/dispatch 的 Beta 明确跳过构建、准备/上传和静态产物；main/PR 的 Beta 失败。聚焦测试使用专用稳定项目，避免 Beta checkout 在跳过前被测试内的真实稳定构建阻塞；真实 builder 仍只接受稳定版本。
- 验证：typecheck、274 项根测试全部通过（5391 断言、43 文件、零跳过/失败）；17 项发布测试包含通道/参数、数值序号、跨通道/部分恢复、未知状态与实际 latest 变化。14 项官网测试在稳定与专用 Beta 源版本环境均通过；actionlint 通过。实际 npm 11.19.0 的 --tag=beta --dry-run 在专用最小包夹具通过，published=false，不是正式候选或真实 Beta 上传。
- 环境：独立工作区补齐已有 HAPI 工作区依赖链接后根检查通过；原工作区审计与用户配置保持不动。包输入与 v1.1.1 无差异，历史交付不变。稳定归档文档的追加 Pages run 36920246993 已成功。
- Commit：`npm-beta-publishing T1: add beta channel and protect stable releases`

## T2 文档与真实工作流预演

- 结果：待推送配置并验证 main 的四平台、五包 OIDC、无上传预演和稳定 Pages；此轮不推送 Beta tag。
