# 官网使用指南

`guide.html` 提供五步 Agent 辅助接入：npm 安装与 Skill → Hub 与浏览器身份确认 → 机器、工具与评审 Agent → MCP 安装并重开客户端 → 首项共享目录只读评审。每步标出由谁操作和完成标志；用户不必自行敲 CLI，手动命令放在折叠参考。工作目录、成果续接、Hub 部署和维护放在进阶部分。

首页与指南使用逐字一致的接入提示和首项任务提示。接入提示以装好 MCP、提醒在项目目录重开结束；新会话中再发送首项任务。评审共享目录以便看到未提交改动，没改动时评审最近提交，非 Git 项目先明确范围。只读是任务要求；主 Agent 读回报告后首次协作才完成，握手成功不能替代真实任务。

指南区分正在对话的宿主与执行目标：机器/runtime 分别全局登记，Agent 为中心空间/仓库配置，本人选择独立。runtime register 明确指定实际机器 ID，不把名字当作 ID，不将握手/机器在线解释成模型已成功运行。

接入使用真实 begin/complete 加密确认，不要求向模型发送 token；MCP 安装保留其他原生配置。无仓库 Runweft YAML、旧 root 认证或离线委派路径。固定 Git 基线、未提交内容不随基线传输、主 Agent 决定合入和保留 worktree 的边界明确。

首页和指南给出相同 npm 安装命令。指南提供从 `$(npm root -g)/runweft/skills/runweft` 定位完整 Skill 的命令，说明 npm prefix/PATH、宿主 Skill 备份与 MCP 的独立接入；维护用 npm 安装目标版本；完整删除使用 runweft uninstall（默认预览，--yes执行），npm uninstall仅删除程序并保留数据。

`manual.html` 转义展示完整使用说明；无 Markdown 下载。参考页不执行命令或 HTML。参考导读说明适用人群和页内搜索，接入提示指向上手指南。技术参考正文展示已发布 1.1.4 使用说明；公开包的文档/Skill 已有匿名 DOM 安装和冻结源码证据，历史 1.1.0 保留原样。

本地配置、数据位置、MCP 备份、模型登录、服务版本、排错和清理入口有具体说明。指南中的未知任务/runtime ID 和示例域名需要使用者替换，网站不自行执行这些命令或修改用户配置。

指南 `#native-session` 从“任务 → 查看任务详情”说明“打开原生详情 / 审批”和“打开原生文件”，支持目录及首页链接。审批是否出现沿原生配置，同意后执行相应操作，拒绝可能结束本轮。文件/diff 需要原生会话在线，完成后的代码通过 Runweft 取回；任务追加/续接仍回到主 Agent。手机访问需网络可达的 Hub 地址与同一身份/空间，localhost 仅本机，公网部署沿现有 HTTPS 代理说明。

源文件与部署方式见[官网说明](../../../../../website/README.md)，对应产品行为仍以[安装](../../installation/cli/spec.md)、[MCP 安装](../../installation/mcp/spec.md)、[资源](../../resources/scope/spec.md)、[委派](../../delegation/interface/spec.md)和[部署](../../deployment/spec.md)为准。

三页、两页提示/复制、五步路径、原生会话入口和 27 个站内链接/锚点通过本地自动验收；正式域名三页及文件摘要与验收版本一致，见[本轮验收](../../../archive/2026-10-12-npm-uninstall-release/acceptance.md)。
