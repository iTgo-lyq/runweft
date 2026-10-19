# iclaude 评审原文

评审日期：2026-10-19。评审基线 `ec835fc9ce89177dc7e4bd08a0373c64c4c3b26f`，本机 `iclaude` 入口，Claude Code 2.1.283。此次保留启动脚本的专用配置，启动事件及最终 modelUsage 均报告 `claude-opus-5-5`；进程退出码 0，结果 success，无工具权限拒绝。仅开放 Read/Grep/Glob，未修改仓库文件。

本报告替换前次因调用方额外传入 `--settings`、覆盖 iclaude 专用配置而错误使用 GLM 生成的版本。纠正过程与意见采纳范围见 [评审处理记录](review.md)。本次要求独立审阅，不参考前次报告。

以下保留本次完整最终输出，行号对应评审时文件；结论属于方案评审，不构成新功能运行验收。

---

# Runweft 账号密码与首次接入方案评审（iclaude，只读）

评审基线是 `ec835fc`。我读完了规定的 5 份文档，并只读抽查了 `src/hub/{access,connect,delegation}`、`app.ts`、CLI 命令注册和 Runweft Kit 的 onboarding/delegation 说明。没有运行命令，没有改动文件，也没有复查 HAPI 子模块源码；HAPI 部分的结论来自 research.md，与我看到的 Runweft 侧代码一致。

## 1. 总判断：方向正确，可以推进

- **目标闭环成立。** 账号密码取代用户手工保管 token；浏览器会话和 CLI 凭据分开、可单独撤销；部署者在服务器上协助重置密码；主 Agent 用 CLI 跑出首份结果，MCP 重载不再是看到结果的前置条件。这几项合起来，"退出后能回来、不再保管 token、尽快拿到首个真实结果"都能做到。
- **改动范围克制。** 身份 UUID、空间、成员和资源授权不动，HAPI 不改，也没有新建工作流引擎或身份平台。
- **有一处建议在写 Plan 前改掉。** 连接协议的两段式激活可以合并（见第 4 节第 1 项）。原设计也能工作，只是更重，所以这一项不阻塞方向。

## 2. 第一性功能

**能直接解决目标。** 我对照了现有 Kit（`.agents/skills/runweft-kit/references/onboarding.md`）里的三个断点，方案都去掉了：
- 第 8 行：要求用户在"已有 Hub / 本机启动"之间二选一；
- 第 32 行：要求用户保存身份 token 备份；
- 第 83 行：要求先重开客户端，才能开始首个任务。

**没有核心缺口。** 首次路径需要的 CLI 命令都已存在：
- `hub connect`、`machine enroll/associate/discover`、`runtime register/check`（`src/hub/resources/commands.ts:46-116`）；
- `repository inspect/match/create/bind`（`src/hub/repositories/commands.ts:15-33`）；
- `agent create/select`（`src/hub/agents/commands.ts:18-37`）；
- `task spawn/wait/show`（`src/tasks/commands.ts:133-198`）；
- `runner start`（`src/service-commands.ts:53`）。

真正要新增的只有 `connect complete --wait`，再加上 Skill 重写。

**可以省掉的复杂度：**
- 连接协议的确认→回执→ACK 激活两段式（第 4 节第 1 项）；
- "已登录只确认"这条页面分支（第 4 节第 2 项）；
- 浏览器闲置期限加 lastUsedAt 合并写、`revoke-all` 独立接口：首版用绝对期限就够；改密码本身已经能达到全端退出。这两项可以延后，不设为门槛；
- `hub_accounts` 单独 1:1 建表还是直接加列到 `hub_users`，两种都行，不需要专门讨论。

## 3. 主体技术

**账户/身份分离：成立，改动集中。**
- 现状：用户认证和 JWT `ref` 都直接绑定 `hub_users.tokenDigest`（`src/hub/access/store.ts:114-121`、`src/hub/access/auth.ts:25`）。
- 方案：改成 N:1 的 `UserCredential`，JWT 的 `ref` 指向具体凭据，验证时照旧回查。这是最小改法，动态撤权语义不变。
- 方案点出的关键耦合是对的：`serviceUser` 目前靠读用户摘要来构造后台主体（`store.ts:137-139`），被委派上下文、服务和原生代理反复调用（`delegation/context.ts:26-28`、`delegation/service.ts:40,47,94`、`delegation/native.ts:40`）。删掉 `tokenDigest` 后，后台任务会立刻失去授权。所以它必须和凭据拆分放在同一个交付任务里，`technical.md:149` 已经这样写了，应保持。

**浏览器凭据：成立。**
- 现在主页就把长期 token 放在 `sessionStorage`（`src/hub/app.ts:24,292`）。打开原生页时先清掉继承的存储、断开 opener、只注入短 JWT（`app.ts:141-147`）。
- 把 `rw_id_` 换成浏览器会话凭据基本是原样替换，原生页的边界不变。
- 不用 Cookie、不增加第二个 origin 的取舍是合理的。"关标签需重登"的限制可以接受，因为有了密码，用户退出后照样能回来。

**CLI 凭据：方向正确。** 由客户端生成秘密、Hub 只存摘要，比现在的 RSA 交接简单，也避免了浏览器把自己的秘密复制给 CLI。协议还可以再收一步，见第 4 节第 1 项。

**HAPI 复用：成立。**
- Runweft 网关已经接管 `/api/auth`，浏览器侧的换票由 `exchangeBrowser` 处理（`auth.ts:15-22`）。
- 账号密码完全落在 Runweft 的身份层，不需要动 HAPI pin、launcher 或原生登录。

**Agent 加 CLI 拿首份结果：成立。**
- CLI 发起的任务父上下文是 `kind: 'cli'`（`src/hub/delegation/client.ts:27`），不依赖 MCP 重载。
- 委派前必须匹配当前仓库，只接受 matched 或 non_git（`src/hub/delegation/service.ts:133-134`）。方案用 inspect/match 加必要的 create/bind 来满足，没有绕开这条规则。
- `task wait` 单次最长 540 秒（`tasks/commands.ts:192`），Agent 循环等待即可。
- 推断：用 Claude Code 作执行端时，评审过程中很可能出现原生审批请求。现有 Kit 规则是"只在用户已授权范围内处理"（`delegation.md:43`），默认指令已经授权了只读评审，沿用这条规则即可，不需要新机制。

## 4. 主要意见

### 第 1 项：连接协议的两段式是旧 RSA 交接的遗留，可以改成"确认即激活"（不阻塞，建议写 Plan 前定下）

**事实：**
- 现在需要 ACK，是因为 Hub 要暂存浏览器长期 token 的密文（`src/hub/connect/store.ts:60-61`）。CLI 必须先解密、保存，再 ACK，让服务端清掉密文（`store.ts:77`、`src/hub/connect/client.ts:109-134`）。
- 新方案里秘密在 begin 时就由 CLI 生成，Hub 只存摘要（`technical.md:63,70`），已经没有需要交接或清除的东西。

**推断：** `technical.md:66-68,74` 里的这些内容，都只是为了支撑第二阶段：
- pending 回执文件；
- 预留 credentialId；
- consumed 状态；
- ACK 丢响应后的续接；
- 对已 consumed 请求执行 cancel 时返回"已激活"；
- consumed 后的恢复不受 10 分钟期限约束。

**最小改动：**
1. 浏览器确认的事务里，直接用 begin 时登记的摘要创建并激活这台 CLI 的凭据。
2. `complete` 就是拿这个秘密调一次身份接口：成功则原子保存；仍是 pending 则继续等；401 则查询请求状态（过期、取消或已撤销）。
3. 摘要在 begin 时已固定，重试天然不会产生第二条凭据。确认之后再 cancel，等同于这台 CLI 注销自身。
4. 两段式唯一的实际好处，是 CLI 能在激活前拒绝身份不符的情况，对应现有机器记录 owner 不一致的检查（`client.ts:124-129`）。替代办法：本机已有机器记录时，begin 带上预期的 ownerId，由服务端在确认时拒绝；或者 CLI 拒绝后注销该凭据。
5. 如果用户确认了但 CLI 没有回来，凭据只有那台设备的 `connect.json` 持有，会出现在登录环境列表里，90 天后到期，不构成问题。
6. 验收第 68 行相应改为"未确认、取消或过期的请求不授予凭据"。

**影响：** 少一个接口、一个状态、一个本地文件，以及一整类续接测试（`cli-connect` 里的 ACK 续接用例）。

### 第 2 项："已登录时只需确认连接"和按标签存储的会话几乎不会同时出现（不阻塞，属于简化）

**事实：** 登录状态只存在当前标签的 `sessionStorage` 里（`technical.md:32`、`app.ts:24`）。按浏览器语义，从终端或聊天客户端打开的链接会进入一个新的顶层标签，这个标签的 `sessionStorage` 是空的。

**推断：** Agent 给出的连接链接几乎总是落在新标签里，所以已有账号的用户实际总是看到"登录并连接"。`requirement.md:28` 和 `technical.md:129` 里的"已登录只确认"和"切换登录入口"分支基本走不到。新用户的首次路径不受影响，反正都是一张表单。

**最小改动：**
- 写明来自 Agent 的连接链接默认是"登录并连接"，配合密码管理器自动填充；
- 删掉这条分支，或者降级为同标签内的偶发情况；
- "已登录 / 已有接入"那条验收改成以"已有有效 CLI 连接时跳过浏览器"为准。

授权新设备时重新输入一次密码，本身也合理。

除这两项外，我没有发现会让核心方案不成立的架构矛盾。

## 5. 应保持与可延后

**保持：**
- Identity UUID 不变，加上 N:1 的浏览器/CLI 凭据，JWT `ref` 指向具体凭据并逐次回查；
- `serviceUser` 改为按固定 owner/space 构造内部主体，并和凭据拆分同批交付；
- 浏览器会话按标签存储，不引入 Cookie 或第二个 origin；
- CLI 由客户端生成秘密，浏览器不再把自己的秘密复制给 CLI；
- 部署者用本机管理命令离线重置密码；
- 首次没有目标时默认启动本机 Hub；
- Agent 串接现有 CLI，首份结果先于 MCP 重载拿到；CLI 任务成功、MCP 配置完成、MCP 实际调用分别报告；
- 不新建工作流引擎，不做网页端的全流程就绪追踪。

**可延后，按简单方式实现即可，不设阶段门槛：**
- 闲置期限和 lastUsedAt 合并写；
- `revoke-all` 独立接口；
- 限流维度、假哈希计时、Argon2 参数实测；
- 重置码的输出方式等安全细节；
- 公网 Hub 的开放注册控制（现在 `POST /identities` 本来就不需要认证，见 `src/hub/api.ts:49-56`，不是新问题）；
- 长期记住登录。

**关于顺序：** `technical.md:147` 和 `requirement.md:53` 把交互原型放在整个 Plan 之前。第一个后端场景（凭据拆分、`serviceUser`、连接协议、CLI）不依赖 UI。建议原型只卡住登录和连接页面相关的任务，不卡住后端场景的规划和实现。
