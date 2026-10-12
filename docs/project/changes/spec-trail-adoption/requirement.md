# SpecTrail 工作流与交互原型

## 背景与目标

用户要求用 `iTgo-lyq/spec-trail` 替换现有 project-workflow，迁移历史 Change，并将现有交互页面主体放入独立原型工程，参考工作区 open-folio 的 Cloudflare 免费额度发布方案。工作台消费 SpecTrail 的 JSON 和固定原型引用；本次不在 Runweft 内实现另一套工作台。

## 范围与行为变化

- MODIFIED：项目使用完整、固定来源的 SpecTrail 分发包，流程状态统一存入 change.json；共享提交 hook 和 CI 校验新契约。
- MODIFIED：迁移 39 个已归档 Change 的状态、任务及已有证据，清除 Markdown 重复流程状态；保留目标、方案、验收结论和实测缺口。特殊历史任务编号提供映射，历史时间与本次回填时间明确区分。
- MODIFIED：release-throughput 继续搁置，保存到独立规划分支，既有调研与用户暂停决定持续有效。
- ADDED：独立 `packages/prototype` 包，以当前 Hub 的身份/空间、任务详情、机器、Runtime、Agent、仓库、个人选择和成员界面为基线，支持桌面/平板/手机交互，全部数据为内存示例。
- ADDED：沿用 open-folio 的 R2 固定版本发布，登记项目当前清单、Change previews、设备截图和归档保留标签。

## 验收

- 全部历史 Change 通过 SpecTrail 状态校验，任务与正文对应，原验收证据可追溯，没有把未验证事项变成通过。
- project-workflow 的活跃入口全部切换；实际 Git hook 可阻止错误状态提交且允许合法提交，新 clone 的启用方式有文档。
- 独立原型不依赖 Runweft/HAPI 服务或持久存储，不接受真实凭据；关键交互在 `sandbox="allow-scripts"` 下经 Playwright 验证，各设备无横向溢出。
- R2 上传后匿名读取的字节与本地一致；重试保持同版本，失败不登记成功；清单及 Change 引用指向固定版本和源码提交。
- 本地基础检查通过，已有发布流程不被触发为 npm 发版；远端 CI 和发布验证按实际结果记录。

## 授权与协作资源

本次用户指令明确授权工作流替换、历史迁移、原型建设和参照 Cloudflare 发布。AGENTS.md 持续授权主 agent 制定工程细节、每份 Plan 由 iclaude 评审一次、逐任务提交和自动本地验收。本次采用大型 Change，因为横跨历史契约迁移、开发流程和完整交互原型。

- [SpecTrail](https://github.com/iTgo-lyq/spec-trail/tree/67984848b4b3248cddc1dd0258dfba55d1a2ff6f/skills/spec-trail)（2026-10-12）：本地与远端 HEAD 一致，完整原样分发。
- 工作区 open-folio 的 `packages/prototype`（2026-10-12）：已有单 HTML 构建、截图及 R2 条件写入/匿名字节校验实现，可按项目路径适配复用。
- [R2 定价](https://developers.cloudflare.com/r2/pricing/)与[公开桶](https://developers.cloudflare.com/r2/buckets/public-buckets/)（2026-10-12）：Standard 提供免费额度；r2.dev 用于开发预览且有限流，不承诺永久免费或生产 SLA。
