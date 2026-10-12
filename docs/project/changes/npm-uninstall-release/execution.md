# 1.1.4 发布执行概况

## 调查

远端 main 与本地无冲突，本地领先 4 个已完成提交；五包公共 latest/beta=1.1.3，新版本尚不存在。用户已明确授权合入主干和发布。

## T1 准备并验证 1.1.4 输入

- iclaude：成功会话 fec14f86-2218-41af-9ebf-8cb16b3d689b 只读 Plan 评审并重写官网维护文案；主 agent 独立落实，未用 subagent。
- 实现：候选原平台 tarball/双程序hash核验、独立控制整包、无模型客户端PATH、同四平台job内的完整卸载门禁；1.1.4常规说明/Skill/官网统一。
- 验证：typecheck、build、260项根测试（4889断言/42文件/67.33秒）、43项Node发布/官网检查、Linux原平台tarball下8项完整卸载专项、官网构建与三页六宽度Playwright通过；专项不依赖源码dist或模型客户端。原1.1.3 dist/packages原样保留。本地打包记录source.dirty=true，仅用于提交前功能验证；正式发布会在CI从干净tag重新构建。
- 本机缓存只含Linux x64 HAPI，因此首次 --all --reuse-hapi 被构建校验明确拒绝；随后仅打包本机Linux候选验收，没有修改HAPI或冒充本机四平台构建。正式CI仍从固定HAPI构建四个平台。
- Commit：`npm-uninstall-release T1: freeze 1.1.4 and gate promotion on complete uninstall`

## T2 合入主干并正式发布

- 已完成：3f873788b11926d2e51c9ccf9f3f661dc239ab6a 原子推送 main/v1.1.4，包含原4个提交；本地main与远端/tag一致，HAPI远端main=固定8f774b94。actionlint1.7.12通过。发布原run为38237215063，main核心run为38237214679。
- 首轮：beta job通过类型/根/Node检查和四平台构建后，在冻结候选web组失败；尚未上传。
- 官网：初始main Pages run38237214732在公开npm检查明确报告latest未到1.1.4，停止上传；晋级后按计划重新触发最新main。
- 首次发布失败：web组console过期测试authCount从4增为5；上传步骤未运行、原日志无上传开始/描述，匿名五包1.1.4均404。原main run38237214679与本地旧console单项成功，确认不是稳定复现的程序缺陷。按官方clock顺序隔离context后，typecheck和16项console场景通过，包输入与原tag无差异。仅恢复验证控制源码，保留原tag。
- 修正 Commit：`npm-uninstall-release T2.1: isolate expiry timers for deterministic release validation`
- 恢复发布：workflow_dispatch run38239746851使用main验证代码重建原v1.1.4候选；已通过基础检查/四平台构建，继续模型无关集成。包输入与原tag一致，不更改tag或重发未知上传。
- main run38239743801的并行materialize测试在5秒内超时：fixture按HTTP到达先后分配gate，测试却按调用先后等待completion，反序到达会互相等待。改为按operationId绑定gate，主动让第二操作先到达；保留共享只读/独立结束后释放的断言并在finally排空请求。类型检查、该文件5项测试/32断言通过（273毫秒）；没有放宽超时或修改产品。原失败为259通过/1失败/1随后连接错误。
- 修正 Commit：`npm-uninstall-release T2.2: bind concurrent fixture completion to operation IDs`
