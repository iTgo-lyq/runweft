# 原生执行与 HAPI 能力官网验收

2026-10-12，按用户持续授权自动验收并发布。全部新增及修订官网文案由 iclaude 完成；主 Agent 只核对事实、原样集成和验证。

## 需求对应

| 要求 | 实现与证据 |
| --- | --- |
| 原生执行及 HAPI 收益 | 首页 `#native-experience` 说明原生 Codex/Claude、执行机器配置、权限与会话续接，明确执行层基于 HAPI |
| 已开放的产品特点 | 原生消息/工具历史、条件审批、在线会话文件与 Git 暂存/未暂存差异；源码入口和事实依据见 research.md |
| 具体操作及手机入口 | 指南 `#native-session` 对应真实任务详情按钮；手机需 Hub 网络可达及同身份/空间，续接回到主 Agent |
| 保留现有框架与作者 | 两页与 iclaude 最终草稿逐字节相同；CSS/JS/图片未改；首屏、接入提示、首项任务、CLI 命令及原有 ID 保留 |
| 构建、验收与发布 | 15 项发布检查和三页 Playwright 通过，25 个本地链接/锚点有效；新增区块和无 JS 路径可达；六宽度首屏/CTA 与基线相同 |

## 发布

- 源码 `2eb6d4c1fb3a84819e01b146d1c4ad99b5cd57bc`；[核心 CI](https://github.com/iTgo-lyq/runweft/actions/runs/38196238712)与[Pages CI](https://github.com/iTgo-lyq/runweft/actions/runs/38196238787)成功。
- [官网](https://runweft.pages.dev/#native-experience)、[指南](https://runweft.pages.dev/guide.html#native-session)、[唯一部署](https://1cde674a.runweft.pages.dev/)上线；八文件 SHA-256/MIME 与本地构建一致，静态总量 107,487 字节。
- 正式域名及唯一 URL 均通过三页浏览器与新增首页→指南入口检查。Pages artifact 为零，npm 五包的公开 1.1.3 检查通过，未发布程序包或更改 dist-tag。
- 来源、文件摘要、作者会话和验证结果见 [verification.json](verification.json)；原始日志与截图在 `.dev-smoke/website-hapi-capabilities/`。

## 验证范围

此次仅改官网。产品能力核对当前源码及既有 Specs，没有新增模型、物理跨机或手机真机验收；移动端是 Playwright 窄屏验证。`--browser-only` 明确跳过重复 npm 安装，冻结包输入保持 1.1.3。线上浏览器沿会话代理并忽略代理证书错误；八文件另经 HTTP 正常核对，传输设置已记录。不将 HAPI 尚未接通的 App、语音、推送或其他 runtime 写成当前功能。
