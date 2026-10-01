# npm Beta tag 发布

> 状态：进行中
> 规模：中型
> 更新：2026-10-02

## 目标与授权

用户要求增加 Beta 发布流，并已选择“Beta tag 触发”。新增可复用现有可信发布凭证的预发布流程；当前 1.1.1 正式发布继续完成，本 Change 在其关闭后实施。

## 行为变化

### ADDED

- `release/distribution`：推送与源码版本严格匹配的 vX.Y.Z-beta.N 标签时，使用原四平台候选、原 npm OIDC 工作流向 npm beta 标签发布同版本五包；稳定 vX.Y.Z 仍发布 latest。普通分支推送和手动入口只预演。
- `release/acceptance`：检查数值 Beta 序号和beta/latest 的单调前进；恢复回执包含发布通道，Beta 不移动 stable latest。

### MODIFIED

- `website/product`：正式官网继续使用稳定版本；根版本为 Beta 的开发分支只执行官网聚焦测试并明确跳过静态构建/上传，避免稳定官网流程把预发布判作格式错误。

## 验收标准

- [ ] 稳定/Beta 标签均要求精确源码版本；无 Beta 数字、alpha/rc、非法版本、版本不匹配不得正式上传。
- [ ] Beta 发布参数使用 beta，stable 使用 latest；Beta 序号 10 大于 2，Beta 同时高于当前 beta/latest，stable 只检查 latest，跨通道回执拒绝恢复。
- [ ] 五包精确依赖、四平台检查、OIDC、分平台后主包、未知上传停止和原候选恢复继续有效。
- [ ] Beta 源码官网跳过行为清楚，稳定生产流程仍可通过；操作说明包含版本分支、标签、安装和恢复方式。
- [ ] 本地聚焦测试、根检查/actionlint 与真实 main 的授权/预演通过；Specs 与归档清楚区分配置验证和真实 Beta 上传。

## 边界

复用 npm-publish.yml 的既有可信绑定，不新增秘密或权限，不自动按开发分支推送发布。当前任务配置并验证 Beta 流程，不额外公开首个 Beta 版本；真实 Beta tag 上传保留为未取得证据。Beta 源版本在独立开发分支准备，main 保持已发布稳定版本；不新增 Beta 官网或改造 runtime/HAPI。
