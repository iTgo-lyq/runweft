# 1.1.4 发布执行概况

## 调查

远端 main 与本地无冲突，本地领先 4 个已完成提交；五包公共 latest/beta=1.1.3，新版本尚不存在。用户已明确授权合入主干和发布。

## T1 准备并验证 1.1.4 输入

- iclaude：成功会话 fec14f86-2218-41af-9ebf-8cb16b3d689b 只读 Plan 评审并重写官网维护文案；主 agent 独立落实，未用 subagent。
- 实现：候选原平台 tarball/双程序hash核验、独立控制整包、无模型客户端PATH、同四平台job内的完整卸载门禁；1.1.4常规说明/Skill/官网统一。
- 验证：typecheck、build、260项根测试（4889断言/42文件/67.33秒）、43项Node发布/官网检查、Linux原平台tarball下8项完整卸载专项、官网构建与三页六宽度Playwright通过；专项不依赖源码dist或模型客户端。原1.1.3 dist/packages原样保留。本地打包记录source.dirty=true，仅用于提交前功能验证；正式发布会在CI从干净tag重新构建。
- 本机缓存只含Linux x64 HAPI，因此首次 --all --reuse-hapi 被构建校验明确拒绝；随后仅打包本机Linux候选验收，没有修改HAPI或冒充本机四平台构建。正式CI仍从固定HAPI构建四个平台。
- Commit：`npm-uninstall-release T1: freeze 1.1.4 and gate promotion on complete uninstall`
