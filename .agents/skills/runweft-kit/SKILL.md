---
name: runweft-kit
description: 安装、升级和卸载 Runweft，连接 Hub 身份与空间，登记机器及 Codex/Claude runtime，维护中心 Agent、仓库和个人选择，通过 MCP 委派、续接、停止及取回代码/附件，诊断连接和执行问题。用户提到 Runweft 接入、协作 Agent、Hub 后台或任务维护时使用；不用于修改原生模型凭据或配置其他产品。
---

# Runweft Kit

让用户通过对话完成操作，你负责 CLI 与验证；用户只在自己的浏览器注册或登录、核对并授权连接。普通接入一次表单后，继续用 CLI 完成资源准备和第一份报告，不要求用户再发第二段提示。复用既有安装与连接，不从头重建环境。

## 先选择路径

- 安装、首次连接、增加执行机：读 [onboarding.md](references/onboarding.md)。
- 配置机器/runtime、Agent、仓库、个人选择：读 [configuration.md](references/configuration.md)。
- 委派、等待、续接、停止、审批、附件与代码：读 [delegation.md](references/delegation.md)。
- 排错、升级、卸载、当前附件与成果留存：读 [maintenance.md](references/maintenance.md)。

完整卸载先按 maintenance.md 核对版本与预览，不打开业务数据。其他操作先执行 `runweft --version`、`runweft --json config show`、`runweft hub connect status`，了解实际版本、数据根、Hub 和保存的空间；没有程序时先安装。通过 `--help` 核对版本差异，不编造命令。CLI 全局 `--home <目录>`、`--space <UUID>`、`--json` 放在子命令前；示例中的尖括号均替换为真实返回值。

## 不可省略的边界

- 委派必须连接明确 Hub；`mode local` 只是托管本机 Hub，不是离线 Agent/YAML 模式。本机 Hub 同样使用独立身份与空间权限。
- 不索要、读取或打印账号密码、用户/机器凭据、原生模型凭据。凭据不放入 prompt、日志、URL 或命令参数；Web→CLI 使用 `hub connect begin/complete` 确认即激活独立授权。只展示无秘密的核对码/确认链接。身份失效时通过浏览器登录原账号，不自动注册新账号。
- 仅在用户授权范围内修改全局安装/MCP、资源共享、服务或数据。保留其他 MCP、hooks、原生配置和已有会话。不擅自调整模型登录、权限模式或执行机器上的信任设置。
- 用户明确要求完整卸载 Runweft 时，先用 `runweft --home <目录> uninstall` 预览核对范围，再直接执行 `runweft --home <目录> uninstall --yes`，无备份地移除该 home 的全部数据、当前程序、自身 MCP/hook 和已确认的 Skill，并保留其他软件配置、模型凭据、原生会话和用户项目。
- 机器、runtime、Agent 是三个对象；Agent 是 Hub 中的定义，不是当前主宿主。使用完整 UUID，不按名称猜测或创建仓库 YAML。管理员治理不等于能读他人私有内容。
- `spawn` 接受不代表执行成功。未知结果先查询原请求/任务，保留原 request ID 与参数；不得盲目重发、清历史或更换身份绕过不确定状态。
- 受管子 agent 禁用 Runweft MCP，拒绝 CLI/MCP 递归委派；不要绕过。主宿主退出后不后台唤醒或恢复旧父会话。
- 不自动 push、合入成果、删除 worktree 或释放唯一结果副本。分享 runtime 是原生账户执行能力，不是 OS 沙箱。

## 交付给用户

简要报告实际 Hub、空间、资源 ID、已完成操作与真实验证结果，提供 `task open --print` 返回的无秘密任务链接。CLI 是主要操作入口，Web 用于账号授权和需要可视化的会话/审批。分别说明“工具已发现 / MCP 握手 / 原生实际调用 / 模型完成 / 成果可用”，不要互相代替。遇到外部条件缺失，给出具体失败阶段和所需条件，不把仍能自动完成的本地检查交回用户。
