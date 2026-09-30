# 官网使用指南

`guide.html` 提供中文 Agent 优先路径：交付接入说明/Skill → 选择明确 Hub 或托管本机 Hub → 浏览器身份/空间确认 → 机器/runtime/中心 Agent → MCP 与首个任务 → Web 看板及维护。工程命令在折叠参考中，用户不必自行敲 CLI。

指南区分正在对话的宿主与执行目标：机器/runtime 分别全局登记，Agent 为中心空间/仓库配置，本人选择独立。runtime register 明确指定实际机器 ID，不把名字当作 ID，不将握手/机器在线解释成模型已成功运行。

接入使用真实 begin/complete 加密确认，不要求向模型发送 token；MCP 安装保留其他原生配置。无仓库 Runweft YAML、旧 root 认证或离线委派路径。固定 Git 基线、未提交内容不随基线传输、主 Agent 决定合入和保留 worktree 的边界明确。

`manual.html` 以转义后的 UTF-8 原文展示现有使用说明，并提供 Markdown 下载。入口说明官网的单包安装与完整发行目录安装的区别，不改写冻结的包内文档。参考页不执行手册中的命令或 HTML。

本地配置、数据位置、MCP 备份、模型登录、服务版本、排错和清理入口有具体说明。指南中的未知任务/runtime ID 和示例域名需要使用者替换，网站不自行执行这些命令或修改用户配置。

源文件与部署方式见[官网说明](../../../../../website/README.md)，对应产品行为仍以[安装](../../installation/cli/spec.md)、[MCP 安装](../../installation/mcp/spec.md)、[资源](../../resources/scope/spec.md)、[委派](../../delegation/interface/spec.md)和[部署](../../deployment/spec.md)为准。
