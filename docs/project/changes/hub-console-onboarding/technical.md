# Hub 后台与 Agent 接入技术方案

> 状态：已确认
> 来源：[Requirement](requirement.md)
> 更新：2026-10-01；工程决策与本地自动验收按用户持续授权执行。

## 依据与缺口

已核对固定 HAPI `3ac8b08`、现有身份/空间、资源、仓库/Agent 和委派 API。领域服务已经实现所有权、共享、治理及任务隔离；HAPI 没有这些业务资源的后台，Runweft `/hub` 目前只有身份、空间与连接确认。继续使用内嵌 HTML/TypeScript/CSS，不增加前端框架或运行依赖。

现有 Machine、Runtime、Agent、Repository DTO 已提供 permissions；成员页面仍在浏览器按角色推导按钮，需要由 HubStore 返回实际可操作能力。任务 overview 只给有界摘要；补 owner × space 的只读详情，不要求浏览器伪造原生父宿主或开放委派控制。列表、详情和计数复用领域过滤，管理员不得读取其他人的任务或私有定义。

HAPI useAuthSource 使用 `hapi_access_token::<origin>`，useServerUrl 使用 `hapi_hub_url`，原生详情/文件路由为 `/sessions/:id`、`/sessions/:id/files`、`/sessions/:id/file`、`/sessions/:id/terminal`。现网关只允许详情 HTML，缺少子路由；原生 `/api/auth` 又没有选中空间的页面交接。不能仅放链接，也不能写入 root 或持久身份 token。

## 页面与数据流

浏览器身份仍保存在本站 sessionStorage，身份/成员接口继续用原 token；其他领域先向 `/api/auth` 交换带当前 spaceId 的短 JWT，保存在内存。切换空间、退出、身份失效立即清空旧视图和 JWT，异步结果必须与发起时的身份/空间一致；变更后刷新领域数据。所有变更由现有领域 API 校验，前端只依据 permissions 展示动作。创建保留 requestId，网络结果未知时查回执，不盲目重新创建。

后台分为总览、机器、Runtime、Agent、仓库、成员。保留身份领取/导入、token 备份、连接确认与空间导航。机器管理包括在线事实、关联空间、登记/取消、改名、凭据状态与显式撤销；机器初始接入及轮换留给 Skill/CLI，保证 token 在目标机器生成并落盘。Runtime 支持实际探测、注册、改名、共享/撤回、登记和治理，明确工具发现不等于模型可执行，共享不提供 OS 沙箱。

Agent 表单支持完整业务定义、版本条件编辑、私有/成员/空间共享、登记、治理和历史版本；失效 runtime 保留并解释，不自动改绑。仓库支持创建、登记、名称与明确别名，本人 checkout 只读查看；真实 Git 观察和 checkout 绑定由本机 Agent 执行。个人空间/仓库选择与 runtime override 消费已有接口，并提供解析验证。

总览支持任务筛选分页、单任务/轮次配置与报告、文件和代码状态。只读详情按 Hub 用户/空间读取完整已授权任务；任务内容不因 Agent 分享而公开。详情使用同源 HAPI 链接复用消息、审批、文件和终端；受管任务输入/恢复仍由中心入口拒绝旁路。

## 原生页面交接

打开前请求新的当前空间 JWT 并验证目标 session 可读。原生 HTML 注入一个窄范围登录适配脚本，将 HAPI 登录存储键映射到独立标签页 sessionStorage，并固定当前 origin；不写全局 localStorage，不将长期身份 token、凭据或 JWT 放进 URL。从后台创建同源空白新窗口，清除复制的 Runweft 身份，写入短凭据并断开 opener 后跳转；弹窗被阻止时明确提示。脚本只适配已核对的 HAPI 登录存储键和到期返回入口，不修改原生 UI、launcher 或协议。

网关 `/api/auth` 增加用户空间短 JWT 再交换能力，返回原 JWT（确定性且不延长到期），拒绝同时传 spaceId、无空间 JWT、机器和任务 JWT。原 token API 登录保持现有行为；原生页拒绝直接输入长期 token，提示返回 Hub。HTML 深链接拒绝 hub/server/token 等重定向参数。后台另用仅内存的无空间 JWT 执行本人全局资源探测；它不交给 HAPI。

原生页面凭据最长十五分钟，适配脚本在过期时返回 `/hub`；用户需重新打开，不能无限续期。各标签身份独立；退出后台不宣称撤销其他标签已交换 JWT，身份轮换和成员撤回仍由服务端即时失效。静态放行增加明确文件子路由，不提供终端入口。Socket terminal 与 agent-terminal 输入必须同时拥有执行机器且通过当前执行策略；共享 runtime 不授予交互 shell，读订阅仍按原 session 归属。成员、空间和邀请的有效操作由服务端返回。

## 视觉方案

对象关系是本产品的识别元素：机器 → Runtime → Agent → 任务，以可点击的关系条替代装饰性统计卡。采用现有冷蓝工作台：雾蓝 `#f3f6fa`、纸白 `#ffffff`、深蓝 `#213148`、动作蓝 `#245ac7`、石蓝 `#53657e`、边线 `#d8e1ed`。标题用 Avenir Next/PingFang，正文系统字体，ID/版本用 SFMono/Consolas。桌面左侧身份/空间、右侧资源导航与详情；窄屏导航横向滚动、字段单列，保留键盘焦点、错误和空态。没有数据时指向实际的 Agent 接入操作，不用虚构图表装饰。

## Skill、官网与验证

产品 Skill 放在仓库 `skills/runweft`，随包和网站交付，不安装到开发者全局目录。主体说明安全接入顺序，references 保存完整命令、故障和维护流程；使用真实 begin/complete 加密交接，不让用户把 token 发给模型。Agent 经用户安装授权将 Skill 复制到 Codex `.agents/skills/runweft` 或 Claude `.claude/skills/runweft`，已有不同内容先备份/确认，卸载只删除确认受管的目录；MCP 仍用现有显式命令。升级下载校验配套包并重跑安装，不虚构自升级命令。官网主按钮提供可交给 Agent 的说明和 Skill 下载，Hub 提供填好当前地址的说明。阶段 6 使用当前编译程序/专用本地包验收，阶段 7 用最终同版四平台产物替换下载；不部署在线网站。

任务停止、续接、结果取回与释放仍由 Agent/CLI 执行，Web 给出任务 ID 和操作说明；CLI 可凭当前用户/空间查询同一任务，不要求原主宿主存活，不因此恢复旧主会话。空间管理员不读取或直接处置他人任务，资源撤权由已验收协调器停止绑定执行。离开空间的 owner 以稳定 UUID 展示，不虚构显示名称。

聚焦 API 测试覆盖角色、直接越权、计数隔离、短凭据到期和深链接；Playwright 使用专用 Hub/Runner 验证桌面/390px、资源操作、个人选择、成员和 HAPI 详情。Skill 接入使用专用 Codex/Claude 配置，验证安装/更新/卸载保留其他原生设置和首个任务。完整执行 typecheck、`bun test ./test`、build；失败证据与真实模型/协议替身分开记录。
