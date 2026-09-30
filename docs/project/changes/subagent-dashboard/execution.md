# 全局 Subagent 看板执行概况

## Plan 评审

本 Change 唯一一次 iclaude 评审完成，session `933a00e1-358b-4400-a3c4-dd1b02f49c56`。原只读调查于 2026-09-30 04:00（Asia/Shanghai）开始，读取方案及关联源码后发生四次 API unknown 重试；04:17 中断原调用（exit 0，无 result），保留原 session 并在无工具模式下只续接简短结论。04:19 续接 result success、exit 0，返回 sessionId 与原 ID 一致；没有第二次调查、额外 reviewer 或额度耗尽假设。

| 建议 | 主 agent 判断 |
| --- | --- |
| URL/表单登录写入 HAPI 原 key，JWT 过期重新认证一次 | 采纳。原 HAPI JWT 有效期确为 4h；长期 token 不因过期被删除，重试仅限只读 GET。 |
| 每行区分 phase、观察时间及机器在线状态 | 采纳。复用原事实，未完成行在机器离线/未知时标陈旧；已确认结束的事实继续可查。 |
| open 前检查看板能力，旧 Hub 给出明确替代路径 | 采纳。dashboard:1 随完整页面启用；--hapi 保留原入口。 |
| 删全部服务端库存失败分支 | 不完全采纳。库存错误和 online=null 仍需明确返回，避免页面把未知当在线；不新增另一套全局任务 freshness 状态。 |
| 待处理优先，按父工作区筛选，父 HAPI 详情链接 | 采纳沿现有 attention/status 排序和 parent.cwd 筛选；链接使用真实 HAPI ID，并显式固定当前 origin 的 hub，避免浏览器旧连接覆盖。 |
| 同源 iframe 浏览器驱动、纯函数测试与千任务检查 | 采纳。测试代理/页面不进产品；运行中/未知/失败用专用合成 fixture，真实 C10 记录用于已完成任务。真实浏览器打开尚排队，不冒称实际通过。 |

原件在 `.dev-smoke/reviews/subagent-dashboard/`，包括首调用和同 session 结论的独立进程记录。方案保留无新账号、无数据迁移、无原生 adapter/HAPI UI 改动；只读 API、嵌入页面和候选验收三个任务顺序执行。

## T1 全局只读任务查询

- 结果：新增 JWT namespace 下的 GET `/api/runweft/tasks/overview`，跨父会话、按父 cwd/会话/执行状态筛选，默认 50 条、最多 100 条分页。复用既有 overview 与最早未结束轮次，显式投影阶段/停止/观察时间、Agent/runtime/机器、报告摘要、代码与附件状态；输入、定义、原生日志及完整清单不返回。无真实 HAPI session 不构造身份。
- 结果：库存读取总计 3 秒超时，失败保留持久任务并返回 online=null；离线/未知执行机的未完成行提示陈旧，已结束事实保持。Runtime 只读取已有名称，不探测工具。无数据库迁移或 HAPI 改动，dashboard 能力尚未公开。
- 验证：`bun test ./test/tasks-overview.test.ts` 8 pass / 0 fail、117 assertions；真实 SQLite/HTTP 覆盖 namespace、筛选分页、unknown/未执行/停止、代码交付/取回/释放、附件失败、受限响应、超时、PRAGMA data_version 无变化及无原生执行调用。1000 任务返回 100 条用时 72.0ms；这是当前开发机测量，不作为吞吐承诺。
- 验证：`bun test ./test/tasks.test.ts ./test/task-results.test.ts ./test/task-workspaces.test.ts ./test/task-outputs.test.ts ./test/resources.test.ts` 53 pass / 0 fail；`bun run typecheck`、`git diff --check` 通过。日志 `.dev-smoke/c11-t1-{overview,regression,types}.log`。页面/浏览器/安装在后续任务验证。
- Commit：`subagent-dashboard T1: add authenticated read-only task overview`

## T2 内置看板与统一打开入口

- 结果：CLI 内嵌同源 `/runweft/` 页面、样式及脚本，新增 dashboard:1 能力。`open` 默认打开看板，缺少能力明确提示更新或 `--hapi`；原生入口及详情链接固定当前 Hub，CLI 输出不携带 token。Bun 内置转译首次提供脚本后缓存，不需要源码目录或外部前端依赖。
- 结果：HAPI 登录复用同一 access-token key，URL token 立即移除，JWT 只保留于内存；过期单次重新认证并只重试读取。列表按主工作区/会话/状态筛选分页，5 秒可见页刷新，过期请求不覆盖新结果。展开查看阶段/停止事实/摘要/成果下一步，未知及刷新失败保留真实含义。所有用户文本经 textContent；同源 CSP、no-store、no-referrer 限制资源与凭据传播。
- 验证：`bun test ./test/dashboard.test.ts` 7 pass / 0 fail，覆盖 HTTP 资源及精确路径、认证刷新上限、存储及 URL、请求竞争、停止与成果标签、实际 CLI open 参数与无凭据输出；HTTP 返回的脚本实际加载成功。`bun run typecheck`、`bun run build`、`git diff --check` 通过。
- 验证：`bun test ./test` 173 pass / 0 fail、3693 assertions；`bun run test:service` 成功，`.dev-smoke/service-Vp9Fgf/evidence.json` success=true，独立二进制提供页面/脚本/样式、原生认证及总览，既有 HAPI Web/SSE/WebSocket、local/Hub/无 Runner 服务生命周期通过。日志 `.dev-smoke/c11-t2-{dashboard,all,types-final,build,service}.log`。
- 边界：上述不是实际浏览器布局/交互验收；T3 继续验证真实历史记录、浏览器与候选安装，尚未同步 Specs/归档。
- Commit：`subagent-dashboard T2: embed dashboard and unify browser entry`

## T3 真实记录、浏览器与候选包

- 已验证：`bun run package --all --reuse-hapi` 重新编译 macOS/Linux arm64/x64 四平台候选，HAPI 未改动。`RUNWEFT_SMOKE_REMOTE_EVIDENCE='[".dev-smoke/remote-mcp-I0obyD/evidence.json",".dev-smoke/remote-mcp-IIBTDU/evidence.json"]' bun run test:install` 最终成功；`.dev-smoke/install-FL0qpY/evidence.json` 与内嵌 `.dev-smoke/install-FL0qpY/services/service-PLAuM6/evidence.json` success=true。真实 npm 私有前缀安装与卸载、无源码/Bun PATH 的页面/脚本/样式/认证/服务检查通过；不是公共发布或四平台当前版本原生运行验证。
- 已验证：`.dev-smoke/remote-package-Vyp7Bt/evidence.json` success=true、cleanupErrors=[]。已安装 CLI 在两个已结束原生宿主 fixture 中，准确展示第二轮 completed/stopped、父 cwd、真实 session ID、代码 available、附件 delivered；执行 Runner 离线仍保留可靠完成事实。两轮文件下载与代码 fetch 通过，原生 sessions 集合不增加，没有模型重放。
- 纠正：首次安装验证 `.dev-smoke/install-d7oTHC` 在重启 Hub 后立即断言机器离线，得到 HAPI 恢复的旧活跃心跳，失败保存在 `.dev-smoke/remote-package-3NFG4G`。等待原生心跳到期的检查移到最后一次重启之后，未改变产品库存或重发原生任务；最终验证通过。
- 浏览器：用户于 2026-09-30 明确使用 Playwright。`bun run test:dashboard dist/runweft dist/hapi <两个 C10 evidence.json>` 在专用无 Runner Hub 提供实际编译页面，已结束原生历史以只读 SQLite 快照复制；合成状态只在测试代理中。`.dev-smoke/dashboard-3pZ7AN/evidence.json` success=true、cleanupErrors=[]，Chromium 153.0.8010.12 完成八组检查：登录/续期、筛选分页、纯文本与展开保持、离线及失败恢复、空/无匹配、URL token 移除、1200/375px 布局/焦点、共享登录后打开真实 HAPI 历史会话。原生 sessions 集合不变。桌面/窄屏截图已目视检查，无水平溢出。
- 修正：浏览器复现原生 fetch 作为 DashboardClient 方法调用的 Illegal invocation，改用闭包调用；测试代理另改为 identity 编码，避免 Bun 解压后仍携带压缩标头。重新连接的驱动等待条件改为登录成功且按钮恢复，防止将保留的旧列表当作新认证完成。测试工具默认使用已安装 Chromium，也支持 RUNWEFT_SMOKE_CHROMIUM 指定路径；本机缓存版本与 Playwright 默认 revision 不同，使用显式路径并记录实际版本。
- 验证：`bun run typecheck`、`bun test ./test/dashboard.test.ts`、`bun run build` 通过；`bun run test` 173 pass / 0 fail、3694 assertions。日志 `.dev-smoke/c11-t3-{types-final-browser,root-tests,playwright-settled}.log`。
- 最终候选：浏览器修正后重新执行 `bun run package --all --reuse-hapi`，四平台构建成功；同一组两份 C10 evidence 的 `bun run test:install` exit 0。`.dev-smoke/install-UEzdGr/evidence.json`、其 service-aXMrtx 与 `.dev-smoke/remote-package-dCKnXX/evidence.json` 均 success=true，历史记录总览与离线成果取回再次通过，清理无错误。日志 `.dev-smoke/c11-t3-{package,install}-browser-fixed.log`。HAPI 无改动，未重复上游完整测试。
- Commit：`subagent-dashboard T3: verify browser workflow and installed packages`
