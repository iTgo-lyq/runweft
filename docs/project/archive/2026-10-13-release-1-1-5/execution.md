# 1.1.5 候选准备证据

## T1 原生身份到期验收与发行输入

基线 main `d30c4d473399c6cfeca41136260dcd0fa5d97b3c`。公共 npm 五包 latest/beta 均为 1.1.4，1.1.5 均不存在，版本 tag 未占用。

原 [main CI](https://github.com/iTgo-lyq/runweft/actions/runs/38344006472)的后台验收失败为到期前认证请求计数 `2 !== 1`；HAPI 的 `useAuth` 在到期前一分钟检查认证，Runweft 的 `exchangeBrowser` 对限时 JWT 原样返回，既不创建身份，也不续期。定向本地基线成功，说明旧计数断言受时序影响。

修正为显式推进至到期前 30 秒，等待真实认证响应并核对仍为原 JWT；随后推进过期，核对凭据删除、导航、没有新身份创建及认证只使用原限时 JWT。产品源代码和 HAPI pin 不变。

本地 `bun scripts/smoke-hub-console.ts dist/runweft` 成功，覆盖后台全场景及清理，日志 `.dev-smoke/release-1.1.5/console.log`；`bun run typecheck`、`bun run build`、文档检查（316 文件，851 链接，0 错误）、流程检查（45 Change）、`git diff --check` 通过。根测试 257 项与 Node 58 项沿用本轮集成的成功证据；正式发布工作流仍会对干净冻结候选重跑核心及全部所需发布门禁。

根版本及当前包内安装示例改为 1.1.5，完整卸载“1.1.4 起”的历史事实保留。候选由不可变 tag 的干净源码在正式 CI 构建，本地准备不等于正式发布已成功。用户的正式发布与耗时测量授权覆盖后续版本合入、tag 推送、公开发布和官网接续。
