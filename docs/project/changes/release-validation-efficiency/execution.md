# 实施与测量证据

## T1 取消残留计时器并去除重复服务验收

环境为独立 worktree、Bun 1.4.2、Node 24.21.0、固定 HAPI 8f774b9。access/storage 直接使用公共 1.1.5 原候选：CLI SHA-256 `88607380ea652e45aa3878c884715f8a10a33f0d31073b82766a3370d061f75a`，HAPI `269d3f183b7bdcb17839bd688769d3c6a88e56a1d2f605c6f791b83bbb7dc16e`。两轮使用相同 tarball 和二进制，逐组顺序测量。

service-package 使用本地干净 bf44ce9 构建的一份 1.1.5 四平台候选，前后不重建：CLI `4b1d2771e35f7ff7e3c95b71f7c97c441be20b90c6fc1f252fc6e28d8b9f9ce8`，HAPI `dd19ccf3eaa19adece47d3b2caddec9eb7c7af88857124bdf8e11ac0619e15ad`。这与公共二进制是两份不同构建，性能对比只在各自同候选内成立，不能混算为公开包结果。

旧代码上的进程退出回归测试实际失败：完成关闭后 2.5 秒仍保活。修复后整段测试约 23 毫秒完成；忽略 SIGTERM 的测试进程仍在约 5 秒后 SIGKILL 并判失败。`bun test test/smoke-deadline.test.ts test/smoke-lifecycle.test.ts` 为 5 通过、0 失败，`bun run typecheck` 通过。MCP 和 Runner 专项共用可取消截止计时器；未新执行真实模型专项，模型行为未改变。

服务组 89.757 → 68.243 秒，省 21.514 秒；旧三项为原始目录 21.121、tarball/symlink 37.224、npm launcher 30.551 秒，后两项均保留。access 159.370 → 140.663 秒，省 18.707 秒。原始日志、每用例 JSON 和冻结候选保留于本 worktree 的 `.dev-smoke/efficiency/`；成功的现场已按脚本关闭并移除测试凭据。

storage 249.565 → 207.668 秒，省 41.897 秒，11 项全部通过。此轮顺序测量证实总计约 60.6 秒的 access/storage 空等和 21.5 秒的重复服务检查可移除；这些是不同阶段的脚本时间，不能直接相加当作并行发布链路的节省。
