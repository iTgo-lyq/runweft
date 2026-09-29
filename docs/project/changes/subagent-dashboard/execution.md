# 全局 Subagent 看板执行概况

## Plan 评审

本 Change 唯一一次 iclaude 评审完成，session `933a00e1-358b-4400-a3c4-dd1b02f49c56`。原只读调查于 2026-09-30 04:00（Asia/Shanghai）开始，读取方案及关联源码后发生四次 API unknown 重试；04:17 中断原调用（exit 0，无 result），保留原 session 并在无工具模式下只续接简短结论。04:19 续接 result success、exit 0，返回 sessionId 与原 ID 一致；没有第二次调查、额外 reviewer 或额度耗尽假设。

| 建议 | 主 agent 判断 |
| --- | --- |
| URL/表单登录写入 HAPI 原 key，JWT 过期重新认证一次 | 采纳。原 HAPI JWT 有效期确为 4h；长期 token 不因过期被删除，重试仅限只读 GET。 |
| 每行区分 phase、观察时间及机器在线状态 | 采纳。复用原事实，未完成行在机器离线/未知时标陈旧；已确认结束的事实继续可查。 |
| open 前检查看板能力，旧 Hub 给出明确替代路径 | 采纳。dashboard:1 随完整页面启用；--hapi 保留原入口。 |
| 删全部服务端库存失败分支 | 不完全采纳。库存错误和 online=null 仍需明确返回，避免页面把未知当在线；不新增另一套全局任务 freshness 状态。 |
| 待处理优先，按父工作区筛选，父 HAPI 详情链接 | 采纳沿现有 attention/status 排序和 parent.cwd 筛选；链接使用真实 HAPI ID，并显式固定当前 origin 的 hub，避免浏览器旧连接覆盖。 |
| 同源 iframe 浏览器驱动、纯函数测试与千任务检查 | 采纳。测试代理/页面不进产品；运行中/未知/失败用专用合成 fixture，真实 C10 记录用于已完成任务。真实浏览器打开尚排队，不冒称实际通过。 |

原件在 `.dev-smoke/reviews/subagent-dashboard/`，包括首调用和同 session 结论的独立进程记录。方案保留无新账号、无数据迁移、无原生 adapter/HAPI UI 改动；只读 API、嵌入页面和候选验收三个任务顺序执行。
