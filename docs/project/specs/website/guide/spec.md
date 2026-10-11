# 官网使用指南

`guide.html` 提供中文 Agent 优先路径：npm 安装与包内 Skill 接入 → 选择明确 Hub 或托管本机 Hub → 浏览器身份/空间确认 → 机器/runtime/中心 Agent → MCP 与首个任务 → Web 看板及维护。工程命令在折叠参考中，用户不必自行敲 CLI。

指南区分正在对话的宿主与执行目标：机器/runtime 分别全局登记，Agent 为中心空间/仓库配置，本人选择独立。runtime register 明确指定实际机器 ID，不把名字当作 ID，不将握手/机器在线解释成模型已成功运行。

接入使用真实 begin/complete 加密确认，不要求向模型发送 token；MCP 安装保留其他原生配置。无仓库 Runweft YAML、旧 root 认证或离线委派路径。固定 Git 基线、未提交内容不随基线传输、主 Agent 决定合入和保留 worktree 的边界明确。

首页和指南给出相同 npm 安装命令。指南提供从 `$(npm root -g)/runweft/skills/runweft` 定位完整 Skill 的命令，说明 npm prefix/PATH、宿主 Skill 备份与 MCP 的独立接入；维护使用 npm 安装目标版本和 npm uninstall。

`manual.html` 转义展示当前使用说明的 npm 参考部分，省略末尾离线工程附录；无 Markdown 下载。参考页不执行命令或 HTML。1.1.3参考页、接入对话与公开包的文档/Skill已由匿名DOM安装及冻结源码核对，历史1.1.0保留原样。

本地配置、数据位置、MCP 备份、模型登录、服务版本、排错和清理入口有具体说明。指南中的未知任务/runtime ID 和示例域名需要使用者替换，网站不自行执行这些命令或修改用户配置。

源文件与部署方式见[官网说明](../../../../../website/README.md)，对应产品行为仍以[安装](../../installation/cli/spec.md)、[MCP 安装](../../installation/mcp/spec.md)、[资源](../../resources/scope/spec.md)、[委派](../../delegation/interface/spec.md)和[部署](../../deployment/spec.md)为准。
