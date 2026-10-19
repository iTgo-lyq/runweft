# 执行证据

T1 将 publishCandidate 默认确认预算改为 45 分钟，元数据和渠道标签共用同一 deadline，不在 waitFor 或标签阶段重置。65 分钟 beta job 保持不变。增加跨元数据/标签阶段的模拟时钟测试，核对超出总预算仍保留全部已确认回执并停止，而不会再次获得等待窗口；现有 accepted 不重传、未知结果、摘要及 latest 等测试保持。

根版本和包内说明准备为 1.2.0-beta.3，Specs 和发行手册同步等待预算。产品功能、数据格式和 HAPI pin 未变。

node --test scripts/tests/npm-publish.test.mjs scripts/tests/npm-release.test.mjs：最终 32 pass、0 fail。首次 npm-release 测试因新 worktree 未安装 yaml 失败，补装 Bun 1.4.2 frozen 依赖后通过，锁文件无变化。check-docs 检查 421 个文档、1081 条链接无错误，HAPI 未初始化的 62 条旧链接待主工作区核对；pin 未变。git diff --check 通过，已执行 ci-scope。未重跑产品测试或模型；新发行仍执行完整门禁。

根因证据来自 run 39220225746：260 pass、0 fail；四平台上传均 accepted，Mac x64 在 08:21:51、arm64 在 08:33:12 确认，Linux 两包至 08:35:39 仍 pending，主包从未开始上传。原始候选/摘要和回执留在该 Actions 日志。不重建或重发 beta.2，先观察已接受平台包的最终状态，再使用新版本；新版本公开与四平台验收在本次修改提交时尚未知。
