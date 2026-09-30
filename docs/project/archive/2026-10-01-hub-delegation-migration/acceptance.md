# 第五阶段验收

2026-10-01，按用户与 AGENTS.md 的既有授权完成本地自动验收。七个内部任务均独立实现、验证并提交；本 Change 不承担整体第六阶段的完整后台/Skill 或第七阶段的四平台发行。

## 需求与证据

| 需求 | 实现与验证 |
| --- | --- |
| 明确 Hub、身份、空间；没有本地 YAML/root 退路 | 默认 CLI/MCP、默认 serve 已接集中网关；编译消费测试覆盖缺 Hub/身份/空间/机器、父会话隔离和错误输出；真实服务拒绝 root token 和旧路由 |
| 中心 Agent 与不可变轮次 | 服务端解析、接受与对象绑定同事务；两 runtime 覆盖版本编辑、next 当前配置、固定目标、并发变化、请求丢失、重启和撤权 |
| 原生执行与子进程关闭 | 真实 Codex/Claude 主宿主 × Codex/Claude runtime 四组合调用 spawn/wait/read，实际报告、原生父身份、终态、归档和子 PID 退出均核对 |
| 等待、子会话工具与递归约束 | 四组合均实际等待约 65 秒并收到 timed_out；编译 stdio 覆盖受管子会话空工具列表与直接调用拒绝；真实子 CLI spawn/send 都拒绝递归，保留原生工具 |
| Git 环境先准备，shared/独立/远端 | 默认编译 CLI 经真实 HAPI 与两 Runner：Codex shared 两轮复用、原生历史确认缺失重建、本地 worktree、远端 Claude 输入准备/执行/成果 |
| 附件与代码归任务 owner，无 push 合码 | 验证真实输入/输出字节、目标机器 owner 不能读取发起人文件、Git bundle 取回专用 ref、主 HEAD/文件未改变；显式释放中心引用与远端环境后，主仓库结果 ref 仍在 |
| Web 凭据安全交接 | Playwright 桌面/窄屏 5 组：明确选择、WebCrypto 加密、并发 complete、取消、origin 错误；日志/URL/输出没有身份 token、私钥或 polling secret |
| 服务、机器、runtime、Agent 分开 | 真实 local/hub 双模式、首次无自动机器权限、登记不创建 runtime/Agent、机器凭据撤销/轮换、可选托管 Runner 与重启；连接按 origin 分区 |
| 未上线历史直接清理 | reset 预览/停服/符号链接/损坏旧配置/重复操作回归；真实停止重置后创建新身份与机器，旧身份拒绝，worktree 字节保留；原生 MCP 组合在 reset 后的新 Hub 上委派 |
| 不改造 HAPI、不触及真实部署 | HAPI 仍为固定 revision，子模块无修改；验证全部使用 .dev-smoke 专用 Hub/Runner/模型配置副本，没有部署在线 Hub/Merlin 或编辑用户原生配置 |

## 最终验证

- `bun run typecheck`、`bun run test`、`bun run build`、`git diff --check` 通过。最终 249 pass / 0 fail，38 文件、5143 断言；日志 `.dev-smoke/t7/{typecheck,all-tests,build}.log`。
- `scripts/smoke-hub-native-mcp.ts`：`.dev-smoke/hub-native-mcp-7xOWvH/evidence.json`，success=true、cleanupErrors=[]。四组合长等待分别为 65011、65032、65180、65193 ms。
- `scripts/smoke-hub-consumers.ts`：`.dev-smoke/hub-consumers-lb8biq/evidence.json`，7 组、success=true、cleanupErrors=[]；含真实历史重建和显式成果释放。
- `scripts/smoke-hub-service.ts`：`.dev-smoke/hub-service-MI3IfS/evidence.json`，5 组、success=true、cleanupErrors=[]；含停服重置后重新接入。
- `scripts/smoke-hub-connect.ts`：`.dev-smoke/hub-connect-bnw7yT/evidence.json`，5 组、success=true；使用现有 Chromium headless shell，截图同目录。原生模型调用与 Web 交接分别验证，不把模拟 HTTP 当作真实 runtime。
- T1/T2 的真实机器 RPC/基线链路和 T3/T4 的增量证据见 [Execution](execution.md)；最终组合补上默认接线和原生主宿主调用。

## 调试中保留的事实

早期历史缺失脚本只搜索 sessions，遗漏原生归档目录；第一次失败未进行重建调用。第二次只移走 rollout、保留原生索引，HAPI 已尝试 resume 但未确认；Runweft 保留 unknown，没有重复启动。这是残缺原生存储，不等同于原生确认不存在。最终以同一专用机器/配置重新启动 Runner、提供无历史的 Codex 数据根，原生确认缺失后一次重建成功。两次失败证据保留在 `.dev-smoke/hub-consumers-RaBTAQ/`、`.dev-smoke/hub-consumers-q1h6Rl/`，未将其记作通过，也未修改 HAPI 或放宽未确认执行规则。

## 边界与后续

“远端”实测为同一物理 Linux 机器上的独立 Runner；物理跨机访问条件仍未提供。Mac 实机按约定由用户验证；本阶段只构建 Linux 当前 CLI，四平台同版构建、安装发行、官网与完整后台/Skill 由整体阶段 6/7 继续，不能把旧发行包视为已经包含本次行为。

身份 token 无找回服务；共享 runtime 不提供 OS 隔离。宿主关闭后不恢复主会话，不后台注入结果；代码合入和冲突仍由主 Agent 决定。
