# 官网使用指南

> 现有官网/四平台发行包仍对应旧认证与配置。Hub 集中委派已在当前源码和 Linux 编译 CLI 验收，尚未生成包含这些行为的同版四平台发行包；旧产物证据不证明新接口已发布。

`guide.html` 提供中文首次使用路径：前置条件 → 安装和 PATH → 本地启动 → 全局 MCP → 机器/runtime/Agent 配置 → 在项目发起、等待和读取首次委派。Hub、独立工作区、附件与成果放在首次 local 路径之后。

指南区分正在对话的宿主与执行目标，沿 Agent → runtime → 机器解释引用关系：机器/runtime 分别全局登记，Agent 可以全局或项目级。绑定示例明确 runtime ID 来自 register/list 输出，不把名字当作实际 ID，不将握手/机器在线解释成模型已成功运行。

MCP 和 runtime 示例可以按 Codex/Claude Code 切换，命令可复制；读取结果、后续轮次、远端取回和 Hub 初始化示例仍为旧 CLI 路径；Agent YAML、旧认证和注册步骤不适用于当前源码。固定 Git 基线、未提交内容不随基线传输、主 agent 决定合入和保留 worktree 的边界明确。

`manual.html` 以转义后的 UTF-8 原文展示现有使用说明，并提供 Markdown 下载。入口说明官网的单包安装与完整发行目录安装的区别，不改写冻结的包内文档。参考页不执行手册中的命令或 HTML。

本地配置、数据位置、MCP 备份、模型登录、服务版本、排错和清理入口有具体说明。指南中的未知任务/runtime ID 和示例域名需要使用者替换，网站不自行执行这些命令或修改用户配置。

源文件与部署方式见[官网说明](../../../../../website/README.md)，对应产品行为仍以[安装](../../installation/cli/spec.md)、[MCP 安装](../../installation/mcp/spec.md)、[资源](../../resources/scope/spec.md)、[委派](../../delegation/interface/spec.md)和[部署](../../deployment/spec.md)为准。
