# 宿主 MCP 适配执行概况

## Plan 评审与复核

- 评审：当前工作区 iclaude 会话 `10608b31-2df0-4755-88f0-0d483fb96229`，2026-09-29 10:59–11:06（Asia/Shanghai），退出 0、结果 success。只读源码和文档，未委派其他 agent；本 Change 的一次 Plan 评审已完成，不再重复。
- 原始材料：本机 `.dev-smoke/reviews/host-mcp-adapter/`；本文保存复核结论。

| 意见 | 主 agent 处置 |
| --- | --- |
| Codex 没有原 MCP 条目时 enabled=false 可能配置失败 | 采纳并实测复现 invalid transport；改为完整禁用定义，在原条目不存在、stdio、HTTP 三种情况核对启动与冷续接 |
| 原生参数实验不等于 HAPI 续接能力 | 原文描述的是原生实验，Research 已区分；进一步在 Technical 显式写明 HAPI 承载待 T1 验证 |
| resume 不需要重复传递禁用表 | 采纳。当前 Hub 使用 existingSessionId 重开原行；bootstrap 保留 metadata，launcher 从该 metadata 读取。保留恢复前 Runner 能力检查，不新增第二个 resume 配置来源 |
| Claude 默认 MCP 与 settings 路径不同 | 采纳，明确有/无 CLAUDE_CONFIG_DIR 两套路径，并加入临时 HOME 验证 |
| hook 短期记录需覆盖审批等待 | 采纳，用后删除；未消费记录保留 24 小时，并加入延迟审批验证 |
| 多 cwd 需覆盖同一 Codex app-server | 采纳，纳入 T2 真实宿主验证，不新增任务 |
| 文档入口及历史 revision 易混淆 | 采纳，补 Technical/Plan 入口，标明历史调查和当前固定版本，更新过时“工具分流”表述 |

评审同时确认 Change 独立边界、HAPI 原生落点、安装维护体验和结果通道可行。Claude remote 参数过滤的源码缺口已在评审期间修正为现有 SDK 选项合并；不改写 SDK 查询循环。
