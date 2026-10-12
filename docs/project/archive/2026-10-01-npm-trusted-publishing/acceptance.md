# npm 可信发布验收

2026-10-01 按会话和 AGENTS.md 的持续授权自动验收。五个公开 npm 包已绑定 GitHub Actions，真实五包 OIDC 授权与无上传预演通过；当前公共版本仍为 1.1.0。

## 需求与证据

| 验收项 | 实际结果 |
| --- | --- |
| 候选、版本与恢复 | 本地 typecheck 和 264 项根测试通过；新增八项测试覆盖稳定标签、上传前主包冲突、平台处理等待、回执恢复、未知结果停止、候选来源/依赖与秘密不泄露；原公开候选五包真实 npm dry-run 通过 |
| 五包信任 | 实际 POST 响应均通过 iTgo-lyq/runweft、npm-publish.yml 和 createPackage 匹配检查；API 新增且未删除任何配置，已保存的公开配置与证明见 [verification.json](verification.json) |
| 真实授权 | [CI run 36864700225](https://github.com/iTgo-lyq/runweft/actions/runs/36864700225) attempt 2 的五个包 OIDC 交换均 HTTP 201，整体 success |
| 候选与预演 | attempt 1 四平台构建、安装/默认服务与信号检查全部通过；只重跑失败 job，复用 npm-candidate-36864700225-1；预演 success=true、published=false |
| 认证清理 | 专用 npm logout 成功；专用凭据、认证缓存与临时日志已删除，用户原配置未修改，CI 不保存 npm token secret |

五包为 runweft-linux-x64、runweft-linux-arm64、runweft-darwin-x64、runweft-darwin-arm64、runweft。Linux x64 创建响应通过匹配断言后未保存配置 ID，其后由独立 OIDC 成功再次确认；其余四包保存了服务器返回的公开配置，权限为 createPackage/createStagedPackage，未设置 environment。

CI 候选源码为干净 fe6017e531f06c0c01980d362b8b5b32bc6fde71。四平台真实安装检查运行于 Ubuntu 24.04 x64/arm64 与 macOS 15 arm64/Intel 托管 runner；授权/预演使用 Node 24 和 npm 11.19.0。预演检查已经存在的 1.1.0 并不允许正式上传同版本不同候选。

## 发布行为与边界

正式发布只接受 push 稳定版本标签，标签/源码/索引版本一致；四平台检查后依次上传平台，全部公开完整性确认后才上传主包。普通分支和手动入口只预演。候选/回执保留三十天，恢复重跑原 run 的失败 job；同版本冲突及未知上传结果停止。操作见[开发说明](https://github.com/iTgo-lyq/runweft/blob/bea2509426d9307b5df786aa3bc4c27069ad613e/docs/development.md#npm-可信发布)。

本次完成绑定与真实授权，未上传新版本、创建发布标签或合入 main。当前 main 尚无工作流，手动入口将来合入后可用；标签入口已配置。仓库仍为私有，因此无自动 npm provenance。

正式上传与部分发布失败路径通过聚焦模拟验证，下一次新版本上传尚未执行。新 CI 候选不继承原程序 hash 的模型/Web/实机验收；现有公共 1.1.0 证据仍见[首次 npm 发布](../2026-10-01-npm-publication/acceptance.md)和[发行验收范围](https://github.com/iTgo-lyq/runweft/blob/d7bc66b9ffd7c4c07fbb940280424b11feffc58a/docs/project/specs/release/acceptance/spec.md)。

Specs 已同步 release/distribution 和 release/acceptance；Plan 逐任务提交，完整 Change 归档。
