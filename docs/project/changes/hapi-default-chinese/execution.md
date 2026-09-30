# HAPI 默认简体中文执行概况

## T1 修改 HAPI 默认语言

- 结果：初始化默认值和 HTML lang 改为 zh-CN；有效浏览器选择和翻译英文回退沿用原实现。英文 Vitest / Playwright 夹具显式选择 en；QuotaExceededError 用例在结束时恢复 Storage spy，避免污染后续夹具。HAPI 子模块已独立提交，Runweft 同步 gitlink / revision 与使用说明。
- 验证：HAPI bun run typecheck:web 通过；bun run test:web 的 300 文件、3249 用例全部通过；web 的 test:mermaid-lightbox:e2e 15 项通过。根 Playwright 使用 .dev-smoke/playwright-hapi-language.config.ts 复用现有 Chromium：81 项中 80 通过，包含中英文切换和设置布局。
- 未解决：Scratchlist 的 successful promote-to-queue exits scratchlist mode 断言期望 string[]，实际是包含 text/id/createdAt 的对象数组；其 fixture 与用例均未改动（git diff 为空），与本次语言行为无关，不扩大修复范围。两套真实 Hub 会话 e2e 未运行，不启动模型。
- 证据：.dev-smoke/hapi-default-chinese-{typecheck,tests,e2e,web-e2e}.log；评审结论 .dev-smoke/reviews/hapi-default-chinese/review.md（同一 iclaude 会话续接后正常退出）。
- Commit（HAPI）：`hapi-default-chinese T1: default web language to Simplified Chinese`
- Commit（Runweft）：`hapi-default-chinese T1: pin Chinese-default HAPI and document language preference`
