# 看板实现前复核

2026-09-30 当前源码证据，不把目标界面当作已有实现。

- `src/api.ts` 以现有 HAPI JWT 的 namespace 约束 Runweft API。TaskCoordinator 统一持有 TaskStore，`list/read` 和 `tasks/views.ts` 已给出可靠执行/交付状态；现有 list 要求 parent，缺少无需本机 Runner 的浏览器全局只读查询。新增查询应在任务领域投影，页面不读 SQLite 或重建状态机。
- `overview` 优先展现活跃轮次，包含 report/attention/native_status/stop/Git/code/artifacts；detail 才有 parent 与 session_id。看板需要有界投影补上父来源、执行 flavor、准确 HAPI session 跳转及事实观察时间，不能直接返回完整定义/输入或文件清单。
- `ResourceService.machines()` 为现有只读库存，包含友好名称及在线事实；runtimes() 会主动探测并写检查缓存，不适合看板刷新。runtime 名称可从既有登记快照读取，不重复探测；HAPI 不可用时保持最后业务记录并标记陈旧。
- `src/proxy.ts` 的单地址网关将未处理路径交给 HAPI，`src/service-commands.ts` 的 open 已沿现有访问令牌打开浏览器。可在自有 `/runweft/` 提供嵌入资源，不修改 HAPI UI 或 runtime。
- HAPI Web `useAuthSource.ts/useAuth.ts/useServerUrl.ts` 使用 `hapi_access_token::<origin>`、`/api/auth` 及内存 JWT。详情路由为 `/sessions/<sessionId>`。看板可复用同一来源与认证，链接固定同源，不新设账号。只处理当前 Runweft origin，不把存储的另一个 Hub 当成本次目标。
- 当前 root 使用 Bun 编译单程序、无前端框架；静态 HTML/CSS/JS 可作为文本嵌入编译产物，继续 Node npm launcher，不引入在线 CDN 或独立 UI 部署。CSS/JS 单独文件便于审阅，启动无需源码路径。
- 可验证环境为当前 Linux x64、真实 HAPI 服务与 C10 已完成专用任务。当前未暴露 browser 插件/交互工具，也无在运行的 Dia/Chrome；Codex 提供原生浏览器面板打开工具。T3 将以专用页面驱动同源界面并回传自动断言，尝试使用真实 Codex 浏览器；无法连接时保留实际验证限制，不冒称浏览器通过，不改用户浏览器配置。

- 原语实测：Bun 以 `import … with {type: "text"}` 编译 HTML 后可独立输出内嵌内容，`.dev-smoke/dashboard-browser-research/embed` 成功。真实浏览器探针的面板打开请求返回 queued，尚无页面回传；插件查询未发现可直接使用的已连接 Dia/Chrome 工具，不将云浏览器或未安装的 Opera 当作当前真实浏览器。

- HAPI Web `sw.ts` 只 precache 已构建资源及列出的 HAPI API，没有通配 SPA navigation fallback；自有 `/runweft/` 及 `/api/runweft/tasks/overview` 不在该缓存路由中。机器管理真实路由为 `/settings/machines`；会话链接应带当前 origin 的 `hub` 参数，避免 HAPI 浏览器此前选择的另一个 Hub 覆盖当前连接。
