# 任务附件执行概况

## Plan 辅助评审与主审结论

- 执行者：当前工作区 `iclaude`，会话 `0029f242-a0be-4615-991f-48052e58ceb4`；2026-09-29 19:36–19:46（Asia/Shanghai）。进程退出 0，结果 subtype=success、isError=false。仅 Read/Glob/Grep，无 MCP、无实现修改；原文 `.dev-smoke/reviews/task-artifact-delivery/review.md`，metadata/events 同目录。不重复评审。
- 主审结论：可实施，按用户持续授权采纳下表修正后进入逐任务执行。当前只有文档和底层流式原型证据，不能称附件产品已实现。

| 意见 | 独立核对与处理 |
| --- | --- |
| worktree 中文/空格输入名失败 | 采纳；当前 shared schema 确为 ASCII，T2 统一安全 Unicode 名称，不在 CLI 悄悄改名 |
| preparedFiles 与 worktree cwd/校验重复 | 采纳；主审亦独立发现顺序矛盾。materialize 不绑定 cwd，shared 用新凭据，worktree 单用既有准备/校验并回收下载中间副本 |
| 补交后 wait 与 pending 不工作 | 采纳；当前代码证实 completedRevision 与扫描条件限制。增加 artifactsRevision，保持原完成版本和终态 status，attention 单独说明交付问题 |
| Claude 仓库外输入可能重复审批 | 采纳提前实测；源码已有 --add-dir/claudeArgs 白名单。T2 真实探针决定是否沿原参数提供本轮输入目录，不改默认 permissionMode/runtime 循环，不把整个 home 加入范围 |
| 不可变清单与释放状态冲突 | 采纳；内容版本不可变，留存状态独立，读取按实时对象事实。主审另明确 deleting 状态以保持删除/pin 一致性 |
| 全局 body ceiling 与固定总超时 | 采纳；提高 Bun ceiling 同时保留其他 HTTP 路由上限，文件只用空闲超时与取消，真实限速验证；已有 72 MiB 底层原型证据不代替正式服务验收 |
| 代理 413/配置与 MCP 路径 | 采纳可操作代理提示与部署示例；MCP 只操作 cwd 内路径，CLI 显式路径沿用户权限。未实测各宿主的 MCP 进程沙箱，不把“全部运行在沙箱外”作为既定事实 |
| 自动对账孤立 pin | 部分采纳；pin 前记录本中心接受意图，服务开放前核对该意图，确定未接受才释放。不因任意引用在任务表中不存在就删除，保留未知来源/恢复 pin；无需用户手工维护普通孤立请求 |
| 自动清成功副本、配置分组、命名 | 采纳；成功 spool 和 worktree 中间副本回收，失败候选保留；server.artifacts 分组；清单 delivered/incomplete/none，release/prune 都默认预览加 --apply |
| --input 隐式路径自动上传 | 不采纳本次隐式混合语法；显式 artifact upload 返回稳定可复用对象，再按 ID 引用，避免 UUID/路径歧义及任务重试时自动重新读取已变文件。未减少文件或任务能力 |
| T2/T4 与 T5/T6 调整 | 采纳；T2 专注输入与原生读取，capture/deliver 放 T4 完整输出切片；T3 不提前暴露 --output；T5 先完成留存和部署，T6 在最终组合上做 MCP/安装矩阵 |
| Git 输出与轮次选择 | 采纳说明未忽略输出进入 Git 封存及 Git attention 阻塞文件交付；release 无 round 时先预览全部已结束轮次 |

## T1 无会话的中心文件与 CLI

- 状态：待开始；正式实现和产品验收尚未执行。
