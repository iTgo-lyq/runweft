# Hub 后台与 Agent 接入验收

> 结论：阶段六全部本地验收通过，按用户持续自动验收授权关闭；2026-10-01。

## 需求对应

| 需求 | 实现与证据 |
| --- | --- |
| 完整后台、桌面/窄屏、权限来自服务端 | `/hub` 的机器、Runtime、Agent、仓库、个人选择、成员和任务页面；`hub-console-Nhqtuv` 十二组 Playwright 覆盖完整编辑、分享/治理、版本冲突、失效原因、直接 API 越权及计数隔离 |
| 同仓库个人配置、未知创建不重复 | 个人空间/仓库选择与 override、失效保留 ID；标签页 requestId/摘要与回执查询；同一浏览器多身份验证 |
| HAPI 受限详情、审批与文件 | 独立标签页短 JWT、当前空间不变且不续期、同步标签存储/SSE header 适配；原生消息、刷新、审批、文件、多标签、到期返回、终端拒绝通过 |
| 产品 Skill 与完整接入维护 | `skills/runweft` 四份流程 reference、包内与独立下载、结构校验和独立 Agent 场景；修订后新机 CLI 先登记、未知执行不重发的判断正确 |
| 两宿主专用安装/更新/卸载、首次任务 | 独立安装 201 成功断言及最终审计十二项；`hub-native-mcp-eZQ9jC` 真实加密接入和两宿主 × 两 runtime 的 spawn/wait/read、65 秒 longwait、递归拒绝、轮末进程退出 |
| 官网 Agent 优先、工程参考、真实下载 | `website-HnpBOQ` 十一组：Skill/四平台/子路径下载与校验、320–1440px、键盘/复制/无 JS、DOM 命令安装 Linux x64、坏 hash 不安装 |
| 默认服务与身份连接不回归 | 最终 `hub-connect-nDB3Ry` 五组，`hub-service-0ZaD9P` 五组：独立身份、角色、机器撤销/轮换、Runner 监督、显式 reset 后重新接入 |

## 可追溯验证

全部现场位于 `.dev-smoke/`，不提交凭据、原生输出或浏览器存储。各目录 `evidence.json` 的 `success=true`；Hub 验证 `cleanupErrors=[]`。后台历史与原生 RPC 是明确夹具，非模型/OS PTY；真实模型由 native MCP 验证单独证明。截图已检查桌面/390px 后台、桌面官网和手机指南。

- `bun run typecheck`、`bun run build` 通过，日志 `reviews/hub-console-onboarding/{typecheck-final,build-final}.log`。
- `bun run test`（根 `./test`）：254 pass、0 fail、5206 断言、39 文件，50.82 秒；`reviews/hub-console-onboarding/all-tests-final.log`。
- `bun run test:hub-console`：`hub-console-Nhqtuv/evidence.json`。
- `bun run test:hub-connect`：`hub-connect-nDB3Ry/evidence.json`。
- `bun run test:hub-service`：`hub-service-0ZaD9P/evidence.json`。
- `bun run test:hub-native-mcp`：`hub-native-mcp-eZQ9jC/evidence.json`；之后只修缺 Hub URL 的诊断，不改合法执行路径。
- 官网 `website-HnpBOQ/evidence.json`；独立安装 `runweft-install-cycle-KC3taFHW/evidence.json`；场景 `skill-scenario-final.md`；编译诊断 `connect-diagnostic-PpicAr/evidence.json`。

失败与返修现场、主会话/模型、独立 Agent 标识和 iclaude 评审见 [Execution](execution.md)。未跳过原生权限，未修改用户全局配置或在线服务。

## 交付边界

完整领域后台和 Skill 已交付，没有把遗漏领域功能转给阶段七。当前四平台工作区候选含 Skill 和新版产品索引，未作为最终发行验收；缺 URL 的最后诊断改动尚需统一重新打包。`test:packages` 仍调用旧 service smoke，须由父 Change 最终集成更新，不能声称本阶段已经通过该命令。

阶段七负责同候选整体链路和四平台发行索引；Mac 双架构要构建但本机无实机，物理跨机条件未具备。同机独立 Runner 不表述为物理远端。未 push、公开发布或更新运行中的 Hub/Merlin。
