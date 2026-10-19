# 转发授权执行证据

## T1 修复转发授权并交付测试与全局本地安装

用户报告的运行版本为 1.1.8。调查发现旧页面要求请求 origin 等于页面 origin；当前账号版本虽移除了页面比较，确认服务仍把浏览器 Origin 与 CLI 登记地址比较。隔离当前源码实验得到转发 Origin 返回 401、原 CLI Origin 确认成功。

实现将浏览器 Origin 校验集中到 HTTP 入口，比较本次请求的 Host，拒绝异常或不匹配的 Origin；连接领域仍检查本 Hub 请求、browser 凭据、空间成员关系和原客户端秘密，不改变连接记录、数据库格式、激活或恢复协议。

新增 TCP 转发 fixture，保留真实浏览器的 Host/Origin。新增授权用例先在修复前运行并复现确认失败，再在修复后覆盖注册、登录、已登录标签、端口变化保留原请求、重复确认及错误来源/请求/空间拒绝。任务链接测试分别覆盖直连和 TCP 转发，保留空间、任务和轮次定位并核对原生页面的凭据隔离。

初次类型检查因新 worktree 尚未安装 HAPI 依赖而中断，补齐依赖后通过；HAPI 依赖随后以固定 Bun 1.4.2 再次检查且无变化。定向用例曾因测试注册路径遗漏 `/api/runweft/hub` 而返回无效凭据，修正测试路径并定向复验，不调整产品授权行为。

现有验证：

- `bun run typecheck`、`bun run build` 通过，沿用相同 pin 和摘要校验过的 HAPI 构建。
- `bun run test`：22 项、159 个断言通过。
- `bun run test:tools`：53 项通过。
- `node scripts/check-workflow.mjs`、`node scripts/check-docs.mjs`、`git diff --check` 通过。
- `node scripts/check-runweft-kit.mjs` 与 skill-creator 的 `quick_validate.py` 通过。
- 独立 Agent 静态场景验收覆盖已有转发、转发端口变化、任务深链接、Host 改写及旧数据/缺少工具四类条件，未发现阻塞性指引缺口。该结果不代表模型或真实 Codex 转发实测。

源码版本使用 `1.2.0-beta.4` 区分本地候选，不创建 tag、不发布 npm、不更新公开 Skill。候选来自干净提交 `2c208ee9d6b771cd266de63db95860150516553a`，HAPI pin 未变化。

### 集成及安装结果

- 同提交 [Development checks](https://github.com/iTgo-lyq/runweft/actions/runs/39254661633) 全部通过：262 项无模型集成、核心/工具检查、四平台安装及原型检查。此处是 CI 结果，不代替本机条件。
- 本机完整无模型集成为 261 项通过、1 项 `hub-resources-live` 失败，共 4431 个断言。失败处为 Claude 原生命令版本探测，转发授权和任务链接用例均通过；保留 `/tmp/runweft-forwarding-integration.log` 和失败 fixture 的无凭据证据。
- 定位发现本机 `claude` 是 `claude-dmit` 包装入口。在专用无凭据测试 HOME 中执行 `--version` 因 `resolv.conf` bind mount 失败而退出 125；Codex 版本探测成功。没有更改包装器、模型配置或凭据，没有调用模型。用户随后说明正在操作 Claude，要求发现问题先反馈，已停止 Claude 相关探测，未绕过包装器或改变测试令其通过；本机完整验收中的这一项保留待处理。
- `bun run test:install --candidate dist/packages --case all --report /tmp/runweft-forwarding-install.json` 两种布局均通过，覆盖正常 npm 可选依赖布局、配套程序、MCP 握手、信号转发、失败卸载保留及完整卸载；使用隔离目录，不操作全局用户配置。
- 更新全局安装后，以实际全局入口再运行新增真实浏览器转发用例：1 项、24 个断言通过，日志 `/tmp/runweft-forwarding-global-smoke.log`。

### 当前机器交付

安装前全局程序和运行中 Hub 均为 1.1.8，已有全局 Skill 的六个文件与修改前源码一致。旧程序目录、Skill 及 npm 版本清单保存在 `/home/tiger/.local/share/runweft/local-install-backups/forwarding-XGhUkh`，位于 Skill 扫描目录之外。

通过一次性 loopback npm 源安装未改写的本地主包及 Linux x64 平台包，安装后关闭该源；没有向公共 registry 发布。当前 Node 全局入口 `/home/tiger/.nvm/versions/node/v24.21.0/bin/runweft` 返回 `1.2.0-beta.4`，实际 Runweft/HAPI 的摘要与候选完全一致，其他全局包版本未变化。全局 Skill 安装于 `/home/tiger/.codex/skills/runweft-kit`，六文件与源码及包内内容一致；原目录保留在备份中，没有新增重复发现入口。

旧 `http://127.0.0.1:3210` Hub 保持 1.1.8，旧数据保留。修复版试用 Hub 已通过全局程序启动在 `http://127.0.0.1:3211`，数据根为 `/home/tiger/.local/share/runweft/local-trials/forwarding-beta4-3cpXrb`；健康检查确认版本、hubConnect=2 和 hubAccounts=1。试用尚未创建用户账号、连接机器或运行模型，后续由用户在自己的浏览器授权。

全局安装证据为 `/tmp/runweft-forwarding-global-install.json`。用户体验时应显式使用上述新 home 和 3211 Hub，并由宿主转发到浏览器；现有转发到 3210 的入口仍指向旧版本。当前等待用户本机体验及 Claude 环境问题的反馈，不提前归档、合入 main 或发布包。
