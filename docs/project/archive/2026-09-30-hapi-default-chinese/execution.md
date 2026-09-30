# HAPI 默认简体中文执行概况

## T1 修改 HAPI 默认语言

- 结果：初始化默认值和 HTML lang 改为 zh-CN；有效浏览器选择和翻译英文回退沿用原实现。英文 Vitest / Playwright 夹具显式选择 en；QuotaExceededError 用例在结束时恢复 Storage spy，避免污染后续夹具。HAPI 子模块已独立提交，Runweft 同步 gitlink / revision 与使用说明。
- 验证：HAPI bun run typecheck:web 通过；bun run test:web 的 300 文件、3249 用例全部通过；web 的 test:mermaid-lightbox:e2e 15 项通过。根 Playwright 使用 .dev-smoke/playwright-hapi-language.config.ts 复用现有 Chromium：81 项中 80 通过，包含中英文切换和设置布局。
- 未解决：Scratchlist 的 successful promote-to-queue exits scratchlist mode 断言期望 string[]，实际是包含 text/id/createdAt 的对象数组；其 fixture 与用例均未改动（git diff 为空），与本次语言行为无关，不扩大修复范围。两套真实 Hub 会话 e2e 未运行，不启动模型。
- 证据：.dev-smoke/hapi-default-chinese-{typecheck,tests,e2e,web-e2e}.log；评审结论 .dev-smoke/reviews/hapi-default-chinese/review.md（同一 iclaude 会话续接后正常退出）。
- HAPI Commit：`hapi-default-chinese T1: default web language to Simplified Chinese`
- Commit：`hapi-default-chinese T1: pin Chinese-default HAPI and document language preference`

## T2 更新配套产物并验收

- 结果：配套二进制的登录及设置页面通过 4 组真实浏览器验收；新浏览器（navigator 为 en-US）默认 zh-CN，无效 fr-FR 回退 zh-CN，有效 en / zh-CN 保持选择；中文 → 英文 → 中文切换后刷新均保留选择，无页面异常。
- 验证：Runweft bun run typecheck、bun run test（173 项）、bun run build:hapi --all、bun run build、bun run package --all --reuse-hapi 通过。发行索引使用 T1 的干净源码（dirty=false），固定 HAPI 3ac8b08b2aead13e9eaae459de62d9a5d5df7395。node scripts/verify-packages.mjs 正常退出并完成 5 个包、4 平台格式/许可/校验和及 Linux x64 服务实测；此前 bun run test:packages 包装器在生成 success=true 证据后退出 143，直接 Node 运行确认通过。node website/build.mjs 已重建四平台下载。
- 证据：.dev-smoke/hapi-language-NPMZrv/evidence.json 和两张中文截图；.dev-smoke/release-packages-g74PJB/evidence.json；.dev-smoke/hapi-default-chinese-{build-hapi,build,runweft-typecheck,runweft-tests,package,packages-check-direct,language,website-build}.log。
- 完整交付：dist/runweft-1.0.0-release.tar.gz，778750795 字节，SHA-256 aa1002573618162fb3a43669be74a71abca489dba8c6a53c76ec67bd2638b411；同目录 .sha256 及包内 index.json / SHA256SUMS 与当前产物对应。
- 验收：根据既有本地自动验收授权，Requirement 三项全部满足；同步 dashboard/subagents 规格后归档。新产物未执行模型协作、Mac/Linux arm64 实机或物理跨机复测，也未推送/发布；不把旧产物的模型证据算作本次验证。T1 的一项 Scratchlist 夹具断言失败继续保留。
- Commit：`hapi-default-chinese T2: verify distributions and archive Chinese default`
