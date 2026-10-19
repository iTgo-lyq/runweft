# 中心配置

先用 `hub identity`、`machine list`、`runtime list`、`agent list`、`repository list` 查既有资源，避免重复创建。Web `<Hub>/hub` 可维护同样资源、成员和个人选择；按钮来自服务端权限，直接 CLI/API 不扩大权限。

## 机器与 runtime

```sh
runweft machine show <machineId>
runweft machine discover <machineId>
runweft machine rename <machineId> <名称>
runweft machine associate <machineId> <spaceId>
runweft runtime register codex --machine <machineId>
runweft runtime show <runtimeId>
runweft runtime check <runtimeId>
runweft runtime resolve <runtimeId>
```

机器与 runtime 是 Hub 全局所有者资源。机器在线、工具可发现、模型认证有效是三件事；`check` 不运行模型。原生工具/PATH/登录环境改变后，在对应执行机停止并重新 `runner start`，再验证，不能重启其他机器的 Runner。

明确分享才用 `runtime share <runtimeId> <spaceId>`；撤回用 `unshare`。机器需先关联该空间。`machine detach` 会撤回此空间关联及 runtime 分享；`unregister` 保留 ID 与历史，恢复用 `register`。资源撤权可能停止已绑定受管任务，操作前说明影响。`block/unblock` 是空间管理员治理，不转移资源所有权。机器凭据状态用 `machine credential <id>`，轮换见 maintenance。

## 仓库关联

```sh
runweft repository inspect
runweft repository match --machine <本机machineId>
runweft repository create <名称> --request-id <固定UUID> --alias <明确Git远端地址>
runweft repository bind <repositoryId> --machine <本机machineId>
runweft repository checkouts
```

`inspect` 只读 Git，输出脱敏观察；`match` 未匹配或有歧义时退出 1，不按名字猜。多个 fetch remote 时显式 `--remote <名称>`。没有远端也可创建不带 alias 的仓库再显式 bind；同 clone 的 worktree 共用关联。仓库 URL 不代表权限或访问凭据，不放带密码的 URL。

创建响应未知先 `repository request <原UUID>`；只用同 UUID/相同输入重试。改名/别名/登记用 `rename`、`alias`、`un-alias`、`register/unregister`；解除本人 clone 关联用 `repository unbind --machine <id>`。不在仓库创建 Runweft YAML，不自动认领其他人的 checkout。

## Agent 定义与版本

创建输入是临时 JSON，不是持续配置文件，完整对象示例：

```json
{
  "name": "代码评审",
  "description": "检查正确性与回归，按严重性报告",
  "instructions": "阅读工程约定和当前变更。只报告有证据的问题，不修改代码。",
  "repositoryId": null,
  "runtimeId": "<实际runtimeId>",
  "flavor": null,
  "model": null,
  "reasoningEffort": null
}
```

`repositoryId: null` 表示当前空间全局定义，非空表示该中心仓库。模型/推理参数为空继承执行端默认；非空时必须提供匹配的 `flavor: codex|claude`。不要猜可用模型或把主宿主模型配置同步给执行端。

```sh
runweft agent create --request-id <固定UUID> --file <临时JSON路径>
runweft agent request <原UUID>
runweft agent show <agentId>
runweft agent update <agentId> --expected-version <已读整数版本> --file <完整新JSON>
runweft agent versions <agentId>
```

创建不确定先查 request。版本冲突重新读取并解释差异，不盲目覆盖。只有所有者编辑/看完整版本历史；管理员只能看私有定义治理概要。共享通过 `agent access <id> private|members|space`，members 加 `--member <成员UUID...>`；共享仅限当前空间成员，不共享编辑权、历史或既有任务内容。

## 个人选择与解析

```sh
runweft agent select <agentId>
runweft agent select <agentId> --repository <repositoryId> --runtime <runtimeOverrideId>
runweft agent selection
runweft agent resolve --repository <repositoryId>
runweft agent resolve --agent <agentId> --runtime <runtimeId>
runweft agent unselect --repository <repositoryId>
```

无 repository 选项表示本人的空间默认；仓库个人选择独立于其他成员。override 不改共享定义。显式 Agent/当前仓库选择/空间默认按中心规则解析，保存的失效引用会报错，不自动退回其他定义。查看 eligibility、版本快照与机器再委派。清除选择后才按剩余规则解析；既有任务保留已固定配置，修改定义不重定向它。

## 账号与空间

账号由用户在 Web 或自己的终端输入密码；Agent 不代收。account show/rename、credentials list/revoke 可用 CLI；password/logout-all/recover 由人工隐藏输入或 Web 设置操作。忘记密码联系部署者在服务器运行 account reset-password <username> --output <新文件>，用户在自己的表单消费短期重置码，不让 Agent 读取码。退出当前 auth logout 只撤销此 CLI；改密/重置/全端退出撤销用户环境，Runner 和已接受任务独立。

space list/show/create/rename/permissions/use/leave，space member list/set-role/remove 与 Web 共用权限。用 space use <id> 保存默认，单次 --space 不改变默认；创建或加入不自动切换，失效默认仍能 list/use。既有任务和运行 MCP 固定原空间。

邀请用 space invitation create --role member --output <新的受限文件>，只交付文件引用；accept --file <邀请文件>，list/revoke 按当前空间操作。创建命令不覆盖旧文件，不能把邀请秘密抄进对话或 argv。资源分享和成员治理只在用户原授权范围内执行，不作为首次体验的额外设置步骤。
