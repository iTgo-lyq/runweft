# Hub 资源 CLI 契约

本阶段命令用于已组合集中资源服务的 Hub。默认 `serve` 切换在后续委派迁移阶段完成；旧默认服务会返回 `hub_resources_unavailable`，客户端不会自动启动本地服务或退回旧认证。产品面向 Agent/Skill 操作，本阶段不要求用户手工执行验收。

## 连接与身份

```sh
runweft --home ~/.runweft hub --url https://hub.example.com \
  --identity-file /path/to/runweft-identity.txt --space <space-id> machine list
```

同一 `hub` 命令域下提供 `identity`、`paths`、`machine` 和 `runtime`。`--url` 必填；身份文件支持 Web 下载的备份（核对 Hub origin 与身份 ID）或仅含身份 token 的文本。省略身份文件时读取 `RUNWEFT_IDENTITY_TOKEN`；不接受旧 `RUNWEFT_HUB_TOKEN`。无空间时可管理本人全局资源；解析执行目标须选择空间。

`--json` 输出结构化成功结果，错误走 stderr 且退出码 1。`runtime check` 在资源不可用时同样退出 1。输出不包含身份或机器 token；所有者的工具探测可包含原生命令路径，共享者只收到裁剪概要。

## 机器

| 命令 | 行为 |
| --- | --- |
| `machine enroll [--name <name>]` | 本机持久保存凭据后创建中心机器；重跑确认原接入请求 |
| `machine enrollment <request-id>` | 查询原请求的机器与凭据状态 |
| `machine list` / `show <id>` | 可见机器，包括未连接、离线和取消登记记录 |
| `machine rename <id> <name>` | 使用原生 HAPI 名称更新；首次连接前明确报错 |
| `machine register <id>` / `unregister <id>` | 恢复/取消已有登记，不停止原生会话 |
| `machine associate <id> <space-id>` / `detach <id> <space-id>` | 关联/撤回空间；撤回同时删除该空间 runtime 分享 |
| `machine discover <id>` | 所有者查看实际 Codex/Claude 工具详情，不检查模型认证 |
| `machine credential <id>` / `revoke-credential <id>` | 读取非秘密凭据状态 / 撤销连接凭据 |
| `machine rotate-credential [--replace-pending]` | 轮换当前本机记录的凭据；完成后需重新启动 Runner |

轮换先保存 pending，再提交有条件替换；中断后普通重跑继续确认同一 pending。Hub 已采用更晚凭据时，旧 pending 明确失败；只有显式 `--replace-pending` 才生成新的替换请求。首次接入响应丢失后，即使原凭据已被撤销，显式轮换也可查询原 enrollment 恢复同一机器。

## Runtime 与治理

| 命令 | 行为 |
| --- | --- |
| `runtime register <codex\|claude> --machine <id> [--name <name>]` | 同机同类型注册/恢复同一稳定 ID |
| `runtime list` / `show <id>` / `check <id>` | 可见配置与当前工具观察；历史观察不能证明当前可用 |
| `runtime resolve <id>` | 当前空间下固定 machine/runtime/flavor 与裁剪版本事实 |
| `runtime rename <id> <name>` / `unregister <id>` | 仅所有者修改；不改绑目标或删除历史 |
| `runtime share <id> <space-id>` / `unshare <id> <space-id>` | 仅所有者授予/撤回该空间成员的使用权 |
| `machine block <id> <space-id>` / `unblock <id> <space-id>` | 空间管理员禁用/解除本空间机器 |
| `runtime block <id> <space-id>` / `unblock <id> <space-id>` | 空间管理员禁用/解除本空间单一 runtime |

私有 runtime 的管理员概要不触发探测，不隐含使用或编辑权。查看、解析和实际派发都按中心当前授权检查；客户端结果不是长期授权。

## 本机数据

`hub paths` 按显式 URL 返回 `connections/<规范化连接名>/machine.json`。该 0600 文件保存 Hub、owner、requestId、machineId 和 active/pending；不写仓库，不输出其 token。同一 Hub 换身份会明确拒绝复用，需原身份或独立 `--home`。不同 Hub 使用独立文件。

文件更新在既有 `<home>/client.sqlite` 短写事务内串行，不保存凭据数据库副本，网络请求不持锁。SQLite 在进程退出时自动释放锁，不产生遗留锁文件。原生 Runner 数据仍使用同连接下的 `hapi/`；默认服务启动接线属于后续迁移，不在本阶段自动改写现有用户配置。
