# HAPI 默认简体中文实施计划

> 来源：./requirement.md
> 技术方案：./technical.md
> 执行模式：逐任务提交

## 交付目标

新的 HAPI 网页默认中文，保留已有语言偏好，配套安装产物可直接使用。

## 任务

### T1 修改 HAPI 默认语言

- 交付：在 HAPI 仓库修改默认值与 HTML lang，固定 Vitest/离线 Playwright 的英文夹具并提交；更新并提交 Runweft 的 HAPI gitlink / revision 及使用说明。
- 验收：空/无效语言回退 zh-CN，有效选择及翻译回退逻辑保持可用。
- 验证：bun run typecheck:web、bun run test:web、bun run test:e2e、bun run --cwd web test:mermaid-lightbox:e2e；检查局部 diff。

### T2 更新配套产物并验收

- 交付：重建四平台安装包、完整交付归档与本地官网，完成自动验收、同步规格及归档。
- 验收：配套程序通过 Playwright 语言默认值、切换和刷新验证，所有包的 pin 与校验和一致。
- 验证：bun run typecheck、bun run test、bun run build:hapi --all、bun run build、bun run package --all --reuse-hapi、bun run test:packages、bun .dev-smoke/smoke-hapi-language.ts、node website/build.mjs。

## 整体验证

- 逐项对应 Requirement，记录真实命令及证据路径；不复用旧程序的原生模型验收结果，不改用户配置或启动真实 agent。

## 执行顺序

按原任务依赖及既有 Plan 顺序迁入；未重新安排历史执行。

| 任务 | 前置任务 |
| --- | --- |
| T1 | 无 |
| T2 | T1 |
