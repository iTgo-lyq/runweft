# 身份与空间验收

> 日期：2026-09-30。按用户授权自动完成本地验收；没有要求用户人工操作。

## 结果

本 Change 的独立范围通过：无注册领取身份、备份和导入、轮换、空间与成员管理可使用。全产品多用户执行仍在后续 Change，不因本模块通过而标记总目标完成。

| 需求 | 证据 |
| --- | --- |
| 独立身份、持久归属、旧 token 失效 | `test/hub.test.ts`；编译服务重启；Playwright 备份下载/退出/导入 |
| token 摘要持久化，正文不入日志 | 真实 HAPI 负向请求之后扫描业务 DB/WAL/日志；DOM 属性、浏览器控制台、请求 URL 无 token |
| 角色和跨空间权限 | 直接 HTTP 三角色、跨空间邀请 ID、管理员不可提权；Web 所有者更改角色后另一浏览器刷新生效 |
| 最后 owner 与邀请竞争 | 两个独立进程/连接同时退出仅一个成功；邀请只能被一个身份消费，同人重放安全，移除不能重入 |
| 轮换响应不确定 | Playwright 在服务端成功后丢弃响应，客户端用预存 token 核实并保留原身份 |
| 页面可操作 | 1280px/390px、键盘入口、纯文本名称、空间创建/切换、成员邀请/角色修改、备份下载；截图复核，无页面异常 |
| 新旧认证边界 | 真实配套 HAPI 的 `/api/auth`、session/events、CLI、旧 Runweft API、`/cli` 和 `/terminal` Socket 拒绝身份 token；反向新 API 拒绝 root 与 HAPI JWT |
| 增量迁移和旧行为 | v5/v6 数据保留测试；179 项仓库测试通过，HAPI 依赖测试未混入 |

## 执行命令与证据

- `bun run typecheck`、`bun run build` 通过。
- `bun run test`：179 pass、0 fail、3780 assertions，日志 `.dev-smoke/reviews/hub-identities-and-spaces/full-tests.log`。
- `RUNWEFT_SMOKE_CHROMIUM=/home/tiger/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell bun run test:hub`：8 组检查通过，证据 `.dev-smoke/hub-identity-Pu5w40/evidence.json`。使用编译 CLI、真实 HAPI、专用 home；Runner 关闭，未调用模型或修改用户原生配置，测试服务已停止。
- 初次 Playwright 默认 revision 缺失，改用本机已装 Chromium；不冒充默认环境直接通过。

## 交付边界

本模块在 Linux x64 完成实际自动验收；不涉及跨机执行。所有平台的完整打包仍由总集成 Change 交付。没有更新现有在线 Hub，未发布 npm/远端分支。后续 Web 在 `/hub` 扩展；用户 token 到 CLI/MCP、HAPI 对象权限及集中业务配置尚未交付。
