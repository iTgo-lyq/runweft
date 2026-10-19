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

全局安装时的临时证据为 `/tmp/runweft-forwarding-global-install.json`，上述两个 Hub 和试用路径是清理前的交付情况。后续按用户要求清理，当前机器状态见下。

### 重新体验前清理

用户明确要求“之前的测试数据什么的，全部删除干净”，并补充“包括服务也关闭。我再重新体验整个流程”。通过对应版本 CLI 的 `stop` 先正常停止 3210、3211 Hub，再确认其 Runweft 进程与两个配套 HAPI 子进程均退出，3210、3211、43885、39281 四个端口关闭；没有运行中的 Runweft 进程。另一个来自独立 codex-delegation-lab 的 HAPI 实例不属于本次试用，保留。

删除默认 `/home/tiger/.runweft`、上述隔离试用目录和旧安装备份，以及 297 项已核对归属的 Runweft 测试临时文件/目录（包括前述 `/tmp` 原始日志、失败 fixture 和安装证据）。无备份保留测试账户、空间、连接、任务或日志；源码与已提交验证结论保留。复查相关数据根及临时项均不存在。

全局 Runweft/HAPI 程序和六文件 Skill 在清理前后摘要一致，`runweft --version` 仍为 `1.2.0-beta.4`。未修改或探测 Claude 环境，未重启服务。后续直接按全局 Skill 使用默认 home 重新初始化、启动和接入，无需沿用已删除的隔离路径；当前等待用户重新体验及 Claude 环境问题反馈，不提前归档、合入 main 或发布包。

### Claude 修复反馈后的定向复验

用户反馈“Claude 问题应该修复了”后，仅在新的临时 HOME、CODEX_HOME、CLAUDE_CONFIG_DIR 中复验 `/home/tiger/.nvm/versions/node/v24.21.0/bin/claude --version`，保留当前 PATH，去除模型凭据及 Runweft/HAPI 环境覆盖，不调用模型。命令 stdout 为空，仍退出 125；这次完整 stderr 为：

```text
[claude-dmit] run=/home/tiger/.cache/claude-dmit-isolated/run-mrh9jcrs
[claude-dmit] FAIL CLOSED: [Errno 2] No such file or directory: 'iptables'
```

与上次 resolv.conf bind mount 报错不同，本次包装器启动时找不到 `iptables` 命令。已反馈用户并暂停后续 `hub-resources-live`，没有执行新一轮集成或修改 Claude 程序、配置、凭据及包装器生成的缓存。Runweft 本次临时隔离目录已删除，未启动 Hub/Runner；此前 CI 与本机测试结论保持原始记录。

## T2 按试用反馈放宽账号输入

用户要求用户名与密码不设限制，并通过 Q1 确认仅保留必填。共享账号校验移除用户名的 3–32 位 ASCII 格式和密码的 15–128 码点、256 UTF-16 单元及字符限制；用户名继续去首尾空格并统一小写后检查重名，密码原值哈希与验证。Web 注册/登录、改密和恢复移除对应 HTML 限制及旧提示，人工 CLI 继续复用相同后端规则。身份、空间、权限、当前格式与 HAPI pin 不变。

测试使用中文、内部空格、符号及超过旧上限的用户名，覆盖单字符密码注册/登录、长 Unicode 密码改密/登录、单个空格密码恢复/登录、重复用户名拒绝和空值拒绝；人工 CLI 使用单字符中文名及短密码完成注册、改密、登录和恢复，并检查秘密无回显。

首次六文件定向集成为 20 项通过、1 项失败；账号操作均已通过，失败位于手机宽度断言。放开长用户名后，其默认空间名继承按钮的 `white-space:nowrap`，导致空间导航撑宽页面；将空间名称文本允许正常换行后，仅定向复验失败的浏览器生命周期，通过 1 项、15 个断言。

`bun run typecheck`、`bun run build`、核心 22 项/165 个断言、工具 53 项，以及文档、流程、差异检查通过。上述集成未调用原生模型或 Claude 版本探测；临时 HOME、Codex/Claude 配置均隔离。新增本地候选使用 `1.2.0-beta.5`，不发布 npm 或同步公开 Skill；产品 Skill 与官网没有旧长度/字符要求，本次无需改写。

### 本地安装与生效

从干净提交 `32102f67279cb4622373059dbc43bf77832f89d0` 执行 `bun run package --reuse-hapi`，通过一次性 loopback npm 源全局安装未经改写的主包和 Linux x64 平台包，随后关闭该源并删除安装临时数据。全局入口为 `/home/tiger/.nvm/versions/node/v24.21.0/bin/runweft`，版本 `1.2.0-beta.5`，Runweft 摘要 `89398d1be010cffc129dee2992b02f6263e1ece4c0e9c8d727556279c5aef575`；配套 HAPI 摘要保持 `d72a2ddada75ea806a3abedd9d443602352eac44477eac38d9e1bd52b75467be`。两者与候选一致，其他全局包及全局六文件 Skill 未变。

以实际全局入口执行 `account-cli`、`web-identity`、`web-connect` 中的人工 CLI 生命周期、浏览器账号生命周期及真实转发用例，通过 3 项、54 个断言；其他 4 项显式过滤。该检查覆盖本次放宽规则和已有转发行为，未调用原生模型/Claude 探测。前述首次回归失败现场在确认无进程使用后删除，本轮隔离测试与安装临时目录均已清理。

用户重新体验时已在默认 home 启动 3210 Hub，并有独立 Runner、一个结束的任务。升级前核对轮次均为 finished、原生会话均不活动，校验 Hub instanceId 后只正常停止并重启这个 Hub；保留独立 Runner 进程，由它自行重新连接，避免无关的原生启动探测。运行中健康接口确认 `1.2.0-beta.5`，Runner 在线，账号、空间、成员、机器、runtime、Agent、任务和轮次数量均与升级前一致。公开页面的用户名、密码、改密和恢复表单仅有必填校验。当前等待用户刷新页面继续验收，不合入 main、不发布 npm、不归档；此前 Claude 包装器失败仍独立保留。
