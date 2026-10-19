# 现状依据与方案调查

调查日期：2026-10-19。仓库基线 `bc18a394812360d329090dfcb46137234a4f76e0`，HAPI pin `8f774b9413fd483bc163cc06425d7646f10a7c92`，Bun 1.4.2。用户明确当前没有部署；不检查用户真实运行数据或凭据。

## 身份与执行链路

| 事实 | 证据 | 方案影响 |
| --- | --- | --- |
| 当前用户表直接保存唯一 tokenDigest | [state.ts](../../../../src/state.ts)、[HubStore](../../../../src/hub/store.ts) | 用户 UUID 与登录凭据必须拆开 |
| 同一长期 token 被浏览器和 CLI 共用 | [浏览器确认](../../../../src/hub/app.ts)、[连接请求](../../../../src/hub/connect/store.ts)、[客户端](../../../../src/hub/connect/client.ts) | 独立 CLI 凭据需要改变 connect 契约，不能只换登录表单 |
| 用户 JWT ref 绑定 token 摘要，verify 每次回查 | [AccessAuthority](../../../../src/hub/access/auth.ts)、[AccessStore](../../../../src/hub/access/store.ts) | 新 ref 应绑定具体凭据，保持动态撤销 |
| 后台任务 serviceUser 读取当前用户摘要 | [委派上下文](../../../../src/hub/delegation/context.ts)、[AccessStore](../../../../src/hub/access/store.ts) | 已接受任务改为按稳定 owner/space 构造可信内部主体 |
| 原生新标签清除长期身份、断 opener，仅注入短 JWT | [app.ts](../../../../src/hub/app.ts)、[native-page.ts](../../../../src/hub/native-page.ts) | 自动携带同源Cookie会改变现有短凭据边界，需要明确存储取舍 |
| CLI 已提供 spawn/wait/show，父上下文为 cli | [任务命令](../../../../src/tasks/commands.ts)、[客户端](../../../../src/hub/delegation/client.ts) | 首份结果可在安装MCP后的宿主重开之前取得 |
| 所有委派模式先匹配当前仓库，仅接受 matched/non_git | [委派服务](../../../../src/hub/delegation/service.ts) | 首次Git目录由Agent自动匹配、必要时创建/绑定仓库；减少用户操作不等于移除仓库要求 |
| MCP 任务按当前原生父会话授权 | [MCP 身份](../../../../src/mcp/identity.ts)、[任务存储](../../../../src/tasks/store.ts) | CLI 首次任务不作为新MCP会话的任务冒领 |
| 初始服务不创建用户/机器/Runner；机器与runtime独立 | [部署](../../specs/deployment/spec.md)、[资源](../../specs/resources/spec.md) | 让Agent调用现有CLI准备，不把自动注册藏进服务启动 |

以上均为读取当前代码和 Specs 确认。新的凭据结构、期限、API和界面组合是本 Change 的设计建议，不是现状事实。

## HAPI 复用核对

HAPI [AuthRequestSchema](../../../../hapi/shared/src/apiTypes.ts)、[auth route](../../../../hapi/hub/src/web/routes/auth.ts) 只支持 accessToken 或 Telegram initData；[用户存储](../../../../hapi/hub/src/store/users.ts) 处理外部平台身份与 namespace。其 [LoginPrompt](../../../../hapi/web/src/components/LoginPrompt.tsx) 的密码型输入框实际接收 accessToken；[devices](../../../../hapi/hub/src/web/routes/devices.ts) 登记推送信息，不是可撤销登录会话。

Runweft [公开网关](../../../../src/hub/access/http.ts) 已接管 `/api/auth`，并将短凭据用户主体交给领域授权。没有证据要求修改 HAPI 的 runtime、launcher 或用户模型。

## 密码与浏览器依据

- [Bun 官方哈希文档](https://bun.sh/docs/runtime/hashing)：提供异步 `Bun.password.hash/verify`、Argon2id 和 PHC 编码。当前固定 Bun 1.4.2 已用合成密码在内存中验证正确密码成功、错误密码失败；未测部署吞吐或完整登录链路。
- [OWASP 密码存储](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)：Argon2id 的基础配置为至少 19 MiB、2 次迭代、并行度 1；密码不采用普通 SHA-256 摘要。随机高熵会话秘密的摘要与用户选择的密码哈希是不同场景。
- [OWASP 认证](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)：无 MFA 时建议足够长的密码、允许密码管理器和粘贴、统一失败反馈及登录限流。具体用户名、期限和页面布局为本项目建议。
- [OWASP 会话管理](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)：优先使用 HttpOnly Cookie，明确指出 Web Storage 凭据可被 XSS 读取。现有产品的同源原生页隔离约束使直接Cookie替换不等价，见技术方案的明确取舍；未把“sessionStorage按标签隔离”误称为对同源XSS的安全防线。

读取上述官方资料于 2026-10-19。外部安全原则辅助技术决策，不代表项目已通过安全审计。

## 现状体验证据

本轮使用项目授权的 Playwright，在隔离临时 Hub/数据目录内捕捉当前产品页面；仅使用合成身份并遮罩秘密。截图、步骤和范围说明在 [首次体验审查](onboarding-review.md)。没有运行真实模型、登记真实执行工具或修改用户原生配置。

## 文档校验

首次方案整理时 `node scripts/check-docs.mjs` 通过，413 份文档、1095 个本地链接无错误；`git diff --check` 通过。语义命令 `change.mjs show --change account-password-onboarding` 对新 Change 返回 `errors: []`。

全仓 `node scripts/check-workflow.mjs` 未通过：已有 `hub-glass-prototype` 的集中 Plan 缺少 JSON 中 T1 的同名任务标题。已核对 `origin/develop` 基线存在同一差异，本轮没有修改该 Change；不能据此报告全仓流程检查通过。

## CLI 与 Web 补充核查

用户进一步明确 CLI 为核心后，在 `10da0b76c276cc037b9d13ab16cea71dbdc6b13b` 上完成命令注册和源码比对，结果见 [能力矩阵与证据](cli-web-parity.md)。实际 createProgram 遍历发现 204 个叶子命令路径，其中包含 root/hub 镜像，不能视为 204 个独立能力；没有专用 space 命令组，identity 只有查询。

资源和任务执行已有较完整 CLI，空间协作管理与任务查询是主要实际缺口。任务只读操作当前被 client 构造的机器登记前置拦住，Web 用户空间读接口已提供可复用路径；裸原生 URL 也不能完成新标签的授权交接。HAPI 既有 GET messages 支持有界分页，可用于 Agent 诊断而不扩展 runtime。

此次补充是只读源码证据，没有再运行产品浏览器或 Runweft 模型任务；新增 CLI/Web 契约及人工密码登录仅为设计。用户 Q3 的双入口选择登记在 change.json，需求、技术方案与 R7 记录保持一致。另调用实际 iclaude 对新增方案进行只读评审，结论和克制采纳范围见 [评审记录](review.md)。

补齐后的文档校验：check-docs 检查 416 份文档、1139 个本地链接，0 errors；本 Change 的 show 返回 errors: []，git diff --check 通过。ci-scope 判定仅 Change 文档变动，无生产代码构建/测试范围；未运行或声称运行新增功能测试。全仓 check-workflow 仍报告上述已有 hub-glass-prototype 的 T1 标题差异。
