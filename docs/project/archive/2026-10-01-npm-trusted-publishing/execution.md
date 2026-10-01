# npm 可信发布执行概况

## Plan 评审

iclaude 在当前工作区完成一次只读评审，会话 `1acf298d-b9fb-435b-8e01-453f925410e5`，is_error=false；结果 `.dev-smoke/reviews/npm-trusted-publishing/review.json`。主 agent 采纳稳定标签事件判断、四平台工作流复用、候选/回执保留和恢复、已有版本预演、仓库写权限范围与实际直接发布权限检查。评审关于交换路径未公开、单绑定上限的记忆不代替当日官方 API/资料，操作以实际 list/接口响应为准。

## T1 发布工作流与聚焦验证

- 结果：新增 npm-publish.yml、复用四平台 CLI 安装工作流、稳定版本标签判断、完整候选/冲突/回执恢复与无上传 OIDC 交换检查。普通分支和手动入口仅预演；候选/回执保留三十天。
- 验证：typecheck、264 项根测试通过；真实 1.1.0 五包 dry-run 与完整性检查通过，未上传；YAML/权限/调用依赖和 validate-change/diff 检查通过。CI 在推送后执行，不以本地检查替代真实 runner 证据。
- Commit：`npm-trusted-publishing T1: add reusable four-platform validation and OIDC publication workflow`

## T2 配置五包信任并验证真实授权

- 结果：专用账号 itgo-lyq 完成本人认证，五包实际创建响应均匹配 iTgo-lyq/runweft、npm-publish.yml 和 createPackage。API 新增配置而不撤销历史配置；runweft 与 Linux x64 的创建前查询为空。服务器为其余四个已保存配置同时返回 createStagedPackage。完整脱敏证据见 [verification.json](verification.json)。
- 认证调整：CLI JSON 曾隐藏待验证链接；临时助手改用 npm 官方配置/fetch/webAuthOpener。实测每次请求仍需独立认证，改为核对真实 POST 响应和托管 runner 的 OIDC 结果，减少重复读取；成功包不重发。Linux x64 的创建响应通过匹配断言后未保存 ID，由后续独立 OIDC 交换确认。
- 验证：[真实 CI](https://github.com/iTgo-lyq/runweft/actions/runs/36864700225) attempt 1 已通过构建与四平台原生安装，绑定前首包 OIDC 404 使预演跳过。绑定完成仅 Re-run failed jobs，attempt 2 复用 npm-candidate-36864700225-1；五包交换均 HTTP 201，发布预演 success=true、published=false，整体 success。源码为干净 fe6017e531f06c0c01980d362b8b5b32bc6fde71，没有新版本上传。
- 清理：专用 npm logout 退出码 0，专用 npmrc/globalconfig、认证缓存和临时日志均已删除；不修改用户原有配置，不为 CI 保存 npm token。
- Commit：`npm-trusted-publishing T2: configure five npm trusted publishers and verify hosted OIDC`

## T3 同步规格并归档

- 结果：开发说明补充稳定版本标签、平台先于主包、回执恢复和手动入口条件；Specs 同步可信发布及真实 CI 范围，项目入口改为归档链接。只记录绑定与预演，不记作新版本上传。
- 验证：按持续授权自动验收，Requirement 三项标准有实际证据；validate-change、文档链接与 diff 检查通过，完整目录归档且不覆盖历史归档。产品输入未改动，不重跑已通过的根测试。
- Commit：`npm-trusted-publishing T3: sync specs and archive`
