# 执行证据

T1 将原始程序拒绝用例改为测试目录中的 runweft 副本，并验证副本及源候选都存在。没有修改卸载实现。版本与包内说明推进至 1.2.0-beta.2，失败的 v1.2.0-beta.1 标签不变。发行规格明确共享候选不可作为卸载目标，手册的预发行证据描述改为以实际 tag 的 CI 结果为准。

原发布 run 39218611839 在上传前完整集成出现 252 pass、8 fail：卸载用例误删平台包，后续七项因 ENOENT 失败。上传与晋级步骤未运行，五个 npm 1.2.0-beta.1 元数据均 404。没有盲目重试原 run。

定向命令：bun run test:integration --bin /home/tiger/workspace/runweft-worktrees/account-password-onboarding/dist/packages/runweft-linux-x64/bin/runweft -- ./test/integration/cli-uninstall.test.ts，最终副本保持 runweft 文件名的版本为 8 pass、0 fail、86 断言。该候选是此前的本机平台包，用于覆盖“输入是有效平台安装”条件，不冒充新 beta.2 的整体验收。

新 worktree 的首次 typecheck 因 HAPI workspace 依赖未准备失败；补装固定依赖后 typecheck 通过，HAPI pin 和源码无变化。root Bun 为 1.4.2；HAPI 目录的包管理器 shim 曾选中其声明的 1.4.0，随后显式使用 1.4.2 重新 frozen install，锁文件无变化。文档与 diff 检查通过；原有 hub-glass-prototype Plan/JSON 的继承错误不在本修复范围。

新 tag 发布继续执行四平台构建、完整无模型集成、两种布局安装和 npm OIDC 门禁；完成结果仅以对应 Actions 日志和 registry 为准。本次没有模型调用或 iclaude。
