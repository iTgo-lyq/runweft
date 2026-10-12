# Runweft 原型工程

遵循根目录 AGENTS.md、SpecTrail prototype skill 和本目录 DESIGN.md。

- 此包独立安装、构建与测试；不加入根包 workspace，不依赖产品后端或真实 Hub。
- `src/ui/` 保存从 Hub 抽取的页面主体；新增产品交互先更新对应原型与内存场景，再同步产品。保持提取来源可追溯，不能把 mock 成功当作产品验证。
- 只使用虚构数据和内存状态，禁止真实服务、凭据、浏览器持久存储；iframe 仅有 `allow-scripts`。
- `prototype.json` 是当前入口；变更固定引用经 SpecTrail publish register 写入，产物放忽略的 dist。
- 验收：`bun run build`、`bun run test`；发布前 `bun run screenshots`，覆盖全部入口与声明设备。
- R2 只追加 `runweft/<requestId>/` 对象，不覆盖既有版本，不提交凭据或临时请求文件。
