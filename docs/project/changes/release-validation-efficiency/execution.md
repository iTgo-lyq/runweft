# 实施与测量证据

## T1 取消残留计时器并去除重复服务验收

环境为独立 worktree、Bun 1.4.2、Node 24.21.0、固定 HAPI 8f774b9。access/storage 直接使用公共 1.1.5 原候选：CLI SHA-256 `88607380ea652e45aa3878c884715f8a10a33f0d31073b82766a3370d061f75a`，HAPI `269d3f183b7bdcb17839bd688769d3c6a88e56a1d2f605c6f791b83bbb7dc16e`。两轮使用相同 tarball 和二进制，逐组顺序测量。

service-package 使用本地干净 bf44ce9 构建的一份 1.1.5 四平台候选，前后不重建：CLI `4b1d2771e35f7ff7e3c95b71f7c97c441be20b90c6fc1f252fc6e28d8b9f9ce8`，HAPI `dd19ccf3eaa19adece47d3b2caddec9eb7c7af88857124bdf8e11ac0619e15ad`。这与公共二进制是两份不同构建，性能对比只在各自同候选内成立，不能混算为公开包结果。

旧代码上的进程退出回归测试实际失败：完成关闭后 2.5 秒仍保活。修复后整段测试约 23 毫秒完成；忽略 SIGTERM 的测试进程仍在约 5 秒后 SIGKILL 并判失败。`bun test test/smoke-deadline.test.ts test/smoke-lifecycle.test.ts` 为 5 通过、0 失败，`bun run typecheck` 通过。MCP 和 Runner 专项共用可取消截止计时器；未新执行真实模型专项，模型行为未改变。

服务组 89.757 → 68.243 秒，省 21.514 秒；旧三项为原始目录 21.121、tarball/symlink 37.224、npm launcher 30.551 秒，后两项均保留。access 159.370 → 140.663 秒，省 18.707 秒。原始日志、每用例 JSON 和冻结候选保留于本 worktree 的 `.dev-smoke/efficiency/`；成功的现场已按脚本关闭并移除测试凭据。

storage 249.565 → 207.668 秒，省 41.897 秒，11 项全部通过。此轮顺序测量证实总计约 60.6 秒的 access/storage 空等和 21.5 秒的重复服务检查可移除；这些是不同阶段的脚本时间，不能直接相加当作并行发布链路的节省。

## T2 按实测拆分验收并优化磁盘准备

修复后顺序数据支持 access 两片（约 69/71 秒），storage 三片（workspace+delegation-preparation；repository-export+result-fetch+result-tasks；其余六项，约 69/65/72 秒）。本地同一公共候选并行实测：storage 三片 73.190/66.539/73.190 秒，组墙钟 73.193 秒；access 两片 69.935/71.579 秒，组墙钟 71.581 秒。全 15 个用例均通过，分片之外的 web 三项保持原覆盖；本机并发数字不等同于 GitHub runner 加上准备/排队后的时长。

同一本地候选的两条服务验收并行 38.095 秒，两个独立现场均完成完整服务检查和清理。相比原三次顺序组 89.757 秒共省 51.662 秒；其中去重和并行收益不重复相加。保留 `RUNWEFT_SMOKE_SERIAL=1` 诊断入口，任一并行失败仍等待其他已启动验收结束后抛出聚合错误。

采用 1.1.5 GitHub 已有实测决定 Mac Intel 拆分：安装 131 秒、完整卸载 146 秒，公共下载 6 秒、总 job 311 秒；拆为两个独立现场可去掉关键路径上较短的一段，实际新增排队/准备成本待正式发布确认。两条必需路径仍由统一 install 结果阻止失败晋级。

验证：分片/并行测试 4 通过（含全部 18 项公共集成覆盖、非法分片、两个失败均保留、等待清理和顺序失败终止）；全部 Node 测试 61 通过（含四平台双路径门禁、非零命令和空间不足）；类型检查、actionlint 1.7.12、文档/流程和 diff 检查通过。磁盘策略根据上次结束时约 9 GiB 消耗设置 14 GiB 保底，优先清理 dotnet，后备 GHC/Android，真实构建/验收另按秒采样，尚未把预测余量当作托管 runner 实测。

分片权重来自以下本地同公共候选的修复后顺序数据（秒）。

| 用例 | 秒 | 分片 |
| --- | ---: | --- |
| hub-access | 2.476 | access 1/2 |
| hub-realtime | 56.894 | access 2/2 |
| hub-resources | 66.400 | access 1/2 |
| hub-configuration | 14.017 | access 2/2 |
| artifacts | 21.649 | storage 3/3 |
| inputs | 7.432 | storage 3/3 |
| outputs | 5.490 | storage 3/3 |
| artifact-prune | 10.913 | storage 3/3 |
| repository-export | 5.612 | storage 2/3 |
| repository-import | 15.259 | storage 3/3 |
| result-fetch | 25.144 | storage 2/3 |
| result-tasks | 34.720 | storage 2/3 |
| workspace-preparation | 64.233 | storage 1/3 |
| delegation-native | 11.422 | storage 3/3 |
| delegation-preparation | 4.912 | storage 1/3 |

GitHub [完整预检 38370399338](https://github.com/iTgo-lyq/runweft/actions/runs/38370399338) 与 [开发 CI 38370379759](https://github.com/iTgo-lyq/runweft/actions/runs/38370379759) 均成功。预检源码 3ece4d5；Linux CLI/HAPI 摘要恰与原公共 1.1.5 完全相同，但新包索引及源码提交独立记录。完整组脚本：access 约 151 秒、storage 208 秒、web 41 秒、两条服务并行 64.673 秒（内部各 63.700/57.206 秒）。这体现两核 runner 争用，不能把本机 38.095 秒直接当作 GitHub 时间。四平台打包 89.816 秒。

空间准备 7.002 秒，仅清理 dotnet：可用量由 13,080,608,768 增到 19,247,452,160 字节（12.18 → 17.93 GiB）。进入打包时 15,189,250,048 字节；打包最低 12,301,860,864 字节；完整 inline 验收最低 7,857,491,968 字节（7.32 GiB，服务并行时）。从清理后到采样最低约消耗 10.61 GiB，14 GiB 门槛仍留约 3.39 GiB 的该次实测余量；采样间隔 1 秒，不声称捕获所有瞬时峰值。GHC/Android 未触发清理。对照 1.1.5 beta 日志原先 13G→30G→21G 的边界快照，仅作为先前约 9 GiB 消耗的来源。

iclaude 提醒空参数预检不覆盖公共矩阵，因此增加只读 `verify-run-id`。其 provenance/frozen-input/互斥参数/双重拒绝写操作测试通过，并经 iclaude 定向复核。随后 [公共候选验收 38372185710](https://github.com/iTgo-lyq/runweft/actions/runs/38372185710) 在 a27c0ef 上直接验证原 38345712525 的 1.1.5：6 个分片、5 个平台 job、摘要均成功，promote/website 均 skipped。全 run 08:51:40–08:55:03 UTC，3:23；公共下载 1–3 秒，无新版本传播等待，不是新版本完整发布耗时。

公共分片脚本：storage 1/3、2/3、3/3 为 88、58、73 秒，access 为 77、76 秒，web 43 秒。对应 storage 最长 job 145 秒。Mac Intel 安装 job 72 秒（安装 53），卸载 job 154 秒（卸载 99、排队 10）；后者最后结束，证实在候选已传播场景下 Mac 是关键路径，保留拆分。准备开销和宿主负载有波动，原同候选串行 job 311 秒与本次 154 秒的差不能全部归因于拆分；正式新版本发布另计传播、排队和整体墙钟收益。Linux x64 安装/卸载/网页 job 为 101 秒（32/25/34）；另外两个平台为 68、63 秒。

本地 `bun run build` 及全部根测试 264 通过；独立运行完整卸载（未预先运行同现场安装验收）8 组通过。按复核建议补充测量包装器 SIGTERM 与采样异常测试：子进程真正结束、中断即使子进程正常退出也判失败、采样失败等待子进程结束且不报成功；5 项磁盘测试通过。全部 Node 检查已扩为 64 项。
