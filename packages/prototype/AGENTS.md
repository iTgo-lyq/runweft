# Runweft 原型工程

遵循 SpecTrail prototype skill 和本目录 DESIGN.md。

- 此包独立安装、构建与测试；不加入根包 workspace，不依赖产品后端或真实 Hub。构建使用根目录安装的 React、Radix 与 Tailwind 和 `../ui` 的构建函数。
- `src/pages/` 是重新设计的原型页面，用 React 与 `../ui` 的组件实现，字段与约束以产品 Specs 为准；新增产品交互先更新对应原型与内存场景，再同步产品。组件或样式需要变化时改 UI 库（即改产品），不在本包复制组件代码。不能把 mock 成功当作产品验证。
- 只使用虚构数据和内存状态，禁止真实服务、凭据、浏览器持久存储；iframe 仅有 `allow-scripts`。
- `prototype.json` 是当前入口；变更固定引用经 SpecTrail publish register 写入，产物放忽略的 dist。
- 验收：`bun run build`、`bun run test`；发布前 `bun run screenshots`，覆盖全部入口与声明设备。
- R2 只追加 `runweft/<requestId>/` 对象，不覆盖既有版本，不提交凭据或临时请求文件。
