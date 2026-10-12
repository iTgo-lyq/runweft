# 全局 Subagent 看板技术方案

> 来源：[Requirement](requirement.md)、[Research](research.md)
> 更新：2026-09-30
> 确认依据：用户持续授权自主技术细化、一次 iclaude Plan 评审和本地验收；沿已有只读总览、HAPI 优先与单 CLI 决策。

## 用户入口与界面

`runweft open` 默认打开当前连接的 `/runweft/`，`--hapi` 保留直接打开原有界面。默认打开前核对 health 的 dashboard:1 能力，旧 Hub 明确提示更新或使用 --hapi，不能误落到 HAPI SPA。看板页提供同源 HAPI 会话/机器入口；本地自动 start 沿旧行为，Hub 客户端只验证当前连接，不启动另一个中心。静态资源嵌入编译程序，不添加单独配置、端口或前端服务。

页面是全局任务总览，顶部给出连接与最后刷新时间，下方使用工作区/父会话搜索、执行状态选择、分页及任务列表。每行明确父工作区/主会话、Agent 定义名、机器与 runtime、实际 cwd/共享或独立模式、本轮状态/进程是否结束、代码与附件状态、更新时间及有界摘要。点击展开显示注意原因、原生观察时间、固定代码 ref/下一步和 HAPI 详情链接。无 session 的准备失败不能生成假链接，主 MCP 宿主只有原生 ID 时不当作 HAPI session ID。

视觉采用轻量工具台：浅蓝灰底 #F3F6FA、白色内容 #FFFFFF、深蓝文字 #213148、蓝色操作 #245AC7、琥珀色待处理 #A15B00、绿色完成 #24674E，表格行与可展开详情承载密度；唯一识别元素是逐任务并列的“执行 / 代码 / 附件”状态轨，帮助区分已结束和已交付。标题用系统 Avenir Next/PingFang SC，正文用系统 UI 字体，目录/ID 用 SFMono-Regular/Consolas 等宽，均离线可读；移动端折为条目，保留筛选与详情，键盘焦点可见。不上大面积统计卡片，不增加图表或调度操作。

## 只读数据契约

任务领域提供 namespace 级只读总览，HTTP GET `/api/runweft/tasks/overview` 沿已有 JWT 校验；不接受模型自报 parent，不要求本机 Runner。支持工作区/父会话文本筛选、原有六种 status 及 page/limit（默认 50，上限 100），返回本次 filtered total/页信息、generatedAt、HAPI 库存可用性和有界 items。读取 namespace 的现有任务，经既有 overview 计算状态再筛选分页；不增加状态缓存、数据库迁移或另一套状态机。

页面消费上述投影，领域内部复用 TaskStore 和 overview，选择最早未结束轮次；附上 parent.cwd/发起机器、sessionId、round.phase、observed_at、runtime 名称/flavor 和机器友好名。优先排列已有 attention/unknown，再运行中，最后按更新时间列历史；筛选工作区依据父 cwd，不依据子 worktree。runtime 登记读取已有记录，不主动探测/写状态。查询排除完整输入、定义内容、传输文件映射和原生日志；报告摘要限制 1000 字符，attention 保留必要原因/下一步。停止与状态原值分开传递，不能按 PID 或 session 是否存在猜执行终态。

HAPI 库存查询使用有界超时；不可用时返回持久任务与库存查询错误、机器 online=null，不把离线改成成功或执行失败。只有可靠的 ended 事实能显示已停止；未观察/unknown 明确保留。每行显示 queued/preparing/starting/running/stopping/finishing 对应阶段；执行机离线或库存未知时，未完成行标明状态可能过期，已确认结束的历史事实不被抹掉。读接口不推进任务、启动 Runner、恢复 session、接受审批或执行 cleanup。

## 认证、刷新与失败

页面只与当前 origin 通信，复用 HAPI 的存储 key 与 `/api/auth`，JWT 只在内存；URL/表单登录成功后写回同一 access-token key，让 HAPI 详情沿用登录。open 沿原令牌入口，页面取得 token 后立刻移除地址栏参数；不打印秘密、不把 token 带到会话链接。已在同源 HAPI 登录可直接使用；无令牌时提供同一 HAPI token 登录表单，身份仍由 HAPI 负责，无新账号/权限库。GET 收到 401 时用现有 access token 重新认证一次并重试这次读取，失败才提示重新登录；JWT 过期不删除长期令牌，不无限重试。

每 5 秒刷新，可手动刷新；页面隐藏时暂停，返回后立即查询；同一时刻单次请求，筛选变化取消旧请求，过期响应不能覆盖新条件。列表失败保留最后成功数据并显示时间和原因；初次无数据区分空任务、无匹配和无法连接。所有用户文本以 DOM textContent 渲染，链接由固定同源路径/编码后的 ID 生成，并带当前 origin 的 hub 参数。机器管理链接为 /settings/machines；父会话只有真实 hapiSessionId 时才提供详情链接。CSP 禁外部资源和内联脚本，静态文件 no-store、Referrer-Policy: no-referrer，frame-ancestors 只允许同源，只有自有确切路径被网关拦截。

## 验证与回退

聚焦 SQLite/HTTP 测试验证多个 namespace、工作区/父会话、活跃/停止/unknown/交付失败、无 session、过滤分页、有界输出、HAPI 离线与零模型/零写入；不重复验证原状态机。类型检查、根全量、编译与安装检查保障既有命令。

专用真实 HAPI 服务与已完成原生 fixture 验证安装后的 API、认证和跳转；按 2026-09-30 用户明确授权，使用 Playwright Chromium 自动驱动登录/筛选/展开/刷新/过期/离线与移动布局，无需连接用户浏览器。证据回传专用测试服务，保留桌面和窄屏截图，不把测试路由打包进产品。

没有数据迁移，回退只改变入口/静态资源及新增只读 API；既有 CLI/MCP/HAPI 路径、任务执行与配置不变。

页面脚本使用 TypeScript 保持与任务投影同一类型；Bun text import 将 HTML/CSS/脚本源嵌入单文件，首次读取脚本时由内置 Transpiler 去除类型并缓存。无外部编译器、前端依赖、运行时源码目录或额外部署步骤；同一脚本的认证与请求逻辑可直接在单元测试加载。
