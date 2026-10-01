# npm 可信发布执行概况

## Plan 评审

iclaude 在当前工作区完成一次只读评审，会话 `1acf298d-b9fb-435b-8e01-453f925410e5`，is_error=false；结果 `.dev-smoke/reviews/npm-trusted-publishing/review.json`。主 agent 采纳稳定标签事件判断、四平台工作流复用、候选/回执保留和恢复、已有版本预演、仓库写权限范围与实际直接发布权限检查。评审关于交换路径未公开、单绑定上限的记忆不代替当日官方 API/资料，操作以实际 list/接口响应为准。

## T1 发布工作流与聚焦验证

- 结果：新增 npm-publish.yml、复用四平台 CLI 安装工作流、稳定版本标签判断、完整候选/冲突/回执恢复与无上传 OIDC 交换检查。普通分支和手动入口仅预演；候选/回执保留三十天。
- 验证：typecheck、264 项根测试通过；真实 1.1.0 五包 dry-run 与完整性检查通过，未上传；YAML/权限/调用依赖和 validate-change/diff 检查通过。CI 在推送后执行，不以本地检查替代真实 runner 证据。
- Commit：`npm-trusted-publishing T1: add reusable four-platform validation and OIDC publication workflow`

## T2 配置五包信任并验证真实授权

- 结果：工作流已推送，真实 run `36864700225` 的构建与四平台安装全部通过。专用 npm 网页登录轮询最后返回 404 并转入传统登录提示，已停止；whoami 明确 ENEEDAUTH，尚未读取或修改五包绑定。
- 验证：官方 CLI 信任创建 dry-run 返回目标仓库/工作流和 createPackage 权限；这不是实际绑定。CI 的授权 job 正常请求 GitHub OIDC，首包 runweft-linux-x64 交换返回 npm HTTP 404，预演/上传步骤因此未执行；run 结论 failure 不写成整体通过。权限检查回执位于 `.dev-smoke/npm-trusted-publishing/ci/oidc.json`。
- 未解决：用户本人完成有效的 npm 官方登录/额外 2FA；随后运行专用 bind.mjs 查询/添加/再次核对，再重跑当前 run 的失败授权 job。专用认证目录 `.dev-smoke/npm-trusted-publishing/`，不要读取或打印 npmrc。
