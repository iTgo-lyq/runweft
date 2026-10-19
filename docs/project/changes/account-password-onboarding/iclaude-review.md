# iclaude 评审原文

评审日期：2026-10-19。输入为基线 `62128b383d36a90b36c47323a076bfb9d4c886d9` 的需求、技术方案、首次体验评审和调查依据，可按需只读核对当前源码。调用入口为本机 `iclaude`，Claude Code 2.1.283，实际模型为该入口已有配置 `glm-5.3`；开放工具仅 Read/Grep/Glob。进程退出码 0，结果为 success，无工具权限拒绝。

以下保留其最终评审原文；其中行号对应评审时的文件。主 Agent 对意见的核实与采纳范围见 [评审处理记录](review.md#iclaude-大方向复审)。此报告不构成新功能的运行验收。

---

核实完毕。以下为最终评审。

---

# Runweft 账号密码与首次接入改造方案 — 独立评审(iclaude,只读)

评审基线 `62128b3`(方案文档)，源码事实核实于当前工作区 `develop`。仅读代码与文档，未运行任何命令、未修改文件。

## 一、总判断

**方向正确，可推进。**

方案把“登录凭据”从身份本体拆出、把首次体验从“用户搬运 token + 两轮对话”改成“一张表单 + Agent 驱动 CLI",这两个主方向都直接命中用户目标，且与现有代码的耦合点被正确识别(详见下文代码证据)。经核实未发现会使核心方案不成立的架构性矛盾。方案自身已做的减法(RSA 交接、token 备份/导入、迁移框架、邮箱/SSO)方向正确，新增面控制在登录模型变更的最小必要范围内，没有借机造通用身份平台或工作流引擎。

## 二、功能第一性判断

对照用户四个目标：

1. **账号密码登录、退出可返回、不保管 token** — 直接闭环。现状的最高摩擦点(token 备份弹窗、退出后找回外部 token 副本)在 onboarding-review.md 的实测走查中被准确识别(audit-03、audit-06),改造(密码登录 + 独立可撤销凭据 + 部署者重置)逐点对应。首版不承诺“跨浏览器重启记住登录”是合理边界，不是缺口。
2. **保留身份 UUID / 空间 / 权限 / HAPI** — 闭环。Identity 保留 UUID 作外键，Membership、Machine/Task credential、授权回查模型全部不动；账号逻辑全部落在 Runweft 自有网关层。
3. **少交互、CLI 优先、尽快首份结果** — 闭环且克制。目标路径“一次请求、一张表单、零手工 CLI、无第二段提示”所需的命令面在现有 CLI 中全部存在(证据见下)，方案仅新增 `connect complete --wait` 有界等待与凭据注销两个小能力，编排仍交给 Skill/主 Agent,没有新增 setup 引擎。
4. **无部署、无兼容、部署者重置** — 闭环。schema 20 唯一格式 + 拒绝旧格式保留原文件，与 AGENTS.md 数据策略一致；重置走本机管理命令，不引入邮件基础设施。

**可省掉的复杂度**：方案已自行删除(RSA 交接改为客户端随机秘密 + 服务端摘要，净简化；删除 token 备份/导入/轮换/迁移)。剩余部分(凭据列表/撤销、重置码、限流)分别对应 requirement 验收表中的可观察场景，不属于镀金。我没有发现应砍而未砍的整块设计。

## 三、主体技术判断

### 1. 账户与身份分离 — 成立(事实)

现状 `hub_users` 直接保存唯一 `tokenDigest`,`AccessStore.resolve('user')` 按该摘要查询用户(`src/hub/access/store.ts:116-120`),后台任务 `serviceUser` 复用同一摘要(`src/hub/access/store.ts:137-139`),浏览器与 CLI 最终共用同一 token(确认时把确认者 tokenDigest 存为 `identityDigest`,`src/hub/connect/store.ts:60-61`;CLI 解密 ciphertext 得到的就是 IdentityToken,`src/hub/connect/client.ts:111-114`)。**事实**：这套结构下，多凭据、独立撤销、密码失效语义必然要求拆表。方案的三层结构(Account 1:1 Identity、UserCredential N:1、JWT ref 指向凭据并每次回查)是该问题的最小正确形态。撤权语义表(浏览器单退/撤 CLI/改密码/撤机器)与现有动态回查机制(`src/hub/access/auth.ts:33-42` verify 后 resolve 重查)同构，不依赖 JWT 黑名单。

### 2. 浏览器/CLI 凭据与连接协议 — 成立(事实 + 标注推断)

- **事实**：原生页隔离依赖“清除继承的 sessionStorage 身份 + 断 opener + 只注入短 JWT"(`src/hub/app.ts:141-147`、`src/hub/native-page.ts:16-19`,native-page 还拦截 HAPI 对 `hapi_access_token::*` localStorage 的读写)。换成同源自动携带的 Cookie 确实会击穿该边界，方案保持 sessionStorage 并显式写下 XSS 取舍而非宣称更安全，论据与代码一致。
- **事实**：CLI 侧现状已有 pollingSecret(`rw_cp_` 前缀)与 pending/confirmed/consumed 状态机(`src/hub/connect/client.ts:76-79`、`src/hub/connect/store.ts:65-82`)。方案的“客户端生成秘密 → 浏览器确认只记批准事实 → ACK 事务重查后激活唯一凭据”与现有状态机同构，删掉了 RSA 密钥对与 342 字节 ciphertext,是简化不是加框架。R2(批准与激活分离)、R3(原始会话与派生 JWT 区分)的修正在协议层是必要的，已正确合入方案文本。
- **推断**：激活事务的并发正确性、ACK 丢响应恢复路径可实现但未经运行验证——方案自身已声明“未证明新账户方案可运行”(technical.md 末段)，定位诚实。

### 3. HAPI 复用 — 成立(事实 + 引用)

**事实**：Runweft 网关已接管 `/api/auth` 并以枚举表面代理原生面(`src/hub/access/http.ts:25-32`、`73-77`),短 JWT 注入原生页的机制保持不变。方案全部新逻辑落在 Runweft 自有层，不需要动 HAPI pin、launcher 或 HAPI 用户模型。HAPI 内部(AuthRequestSchema 仅 accessToken/Telegram、users.ts 为外部身份→namespace 映射)引自 research.md 的调查，我核实了 Runweft 侧接管事实与之吻合，未逐文件读 hapi/ 子模块。

### 4. Agent + CLI 首份结果路径 — 成立(事实)

方案工作流表所需的每个命令在现状 CLI 中已存在：

| 方案阶段 | 现状命令 |
| --- | --- |
| 连接 | `hub connect begin/complete/status/cancel`(`src/hub/resources/commands.ts:45-60`) |
| 执行准备 | `machine enroll`(:76)、`machine associate`(:96)、`runner start`(`src/service-commands.ts:53`)、`machine discover`(:98)、`runtime register/check`(:100,:108) |
| 仓库关联 | `repository inspect/match`(`src/hub/repositories/commands.ts:26-28`) |
| 首份结果 | `task spawn/wait/show`(`src/tasks/commands.ts:133,179,188`;show 带 offset/limit 完整读报告) |

**事实**：所有委派模式先 `repository.match` 且仅接受 matched/non_git(`src/hub/delegation/service.ts:133-135`),方案的“Agent 自动 inspect/match → 必要时固定 requestId create/bind → 歧义才问”正是围绕该约束的最小路径，而非绕过授权。**推断**：“一次请求 + 一张表单”的交互次数是目标而非已验证事实，方案已如实标注(onboarding-review.md 末段)。

## 四、主要意见

经核实，**没有发现阻塞推进的架构性矛盾**。以下 1 项为实施排期层面的联动确认，非设计缺陷：

**M1(非阻塞)：「重建 hub_users 凭据结构」与「serviceUser 替换为可信内部主体」必须在同一场景落地，建议在实施计划中显式绑定。**
- 依据(事实):`serviceUser` 现在读取 `this.user(ownerId).tokenDigest` 构造 principal(`src/hub/access/store.ts:137-139`),且委派 lease 每次检查都重新调用它(`src/hub/delegation/context.ts:26-28`)。schema 20 一旦删除 `hub_users.tokenDigest`,该函数即刻失效，即**所有已接受的后台任务**失去授权通道。
- 影响：technical.md L90 已正确识别此改造，但实施顺序(technical.md L147)按用户场景组织，第一个场景是“账号注册登录及退出”——若该场景交付时不同步替换 serviceUser,后台任务会在第一个场景合入时全体失效。
- 最小改动建议：在实施计划中把“schema 重建 + serviceUser 内部主体”标记为第一场景的强制交付物(或作为所有场景的共同前置)，一句话即可，不需要改方案设计。
- 是否阻塞：**不阻塞方案本身**，推进时注意排期即可。

## 五、应保持的部分与可延后的建议

**应保持(方案的这些决定是正确的，评审中不应被细节意见稀释)：**
- Identity UUID / Membership / Machine·Task credential / 授权回查模型原样保留；HAPI pin、原生页协议、launcher 不动。
- connect 的 begin→确认→complete 入口、核对码、pending/confirmed/consumed 状态机骨架。
- sessionStorage 取舍及其在方案中的显式披露；首版不承诺长期记住登录。
- 数据格式“唯一当前格式、拒绝旧格式并保留原文件”；部署者本机重置命令；移除 token 备份/导入。
- 编排留在 Skill/主 Agent,新增 CLI 能力仅限有界等待与凭据注销。
- 原型协调方式：UI 实施前在项目唯一原型包覆盖流程，不作为本轮方案门槛。

**可延后(不应设为本 Change 阶段门槛)：**
- Cookie / 独立 origin / 跨浏览器记住登录(方案已列延后，正确)。
- 邮箱/短信/SSO/MFA、密码参数与限流参数的调优、CLI 凭据 90 天期限的具体值——均属部署后按真实使用再定的细节。
- research.md L44 记录的 `check-workflow.mjs` 失败是 `hub-glass-prototype` 既有登记差异，与本方案无关，不应算入本 Change 的方案质量。

**事实与推断的边界重申**：本评审中标注“事实”的结论均有上述代码行号支撑；HAPI 子模块内部细节引自 research.md;“目标交互次数可实现”“激活事务并发正确”属推断，与方案自身的未验证声明一致，留待实现后的定向验收。
