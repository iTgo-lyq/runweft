# 1.1.1 补丁发布执行概况

## T1 准备版本输入

- iclaude：同一评审会话 94abf728-4dc0-482d-8112-f09dd324ab81；达到读取轮次上限后同会话收束结论，非额度耗尽。结论无阻塞。
- 判断：采纳常规使用说明/静态产物明确版本断言、tag 后 packageInputs 冻结，以及 uploading 未确认时的停止边界；不新增产品功能或更改发布规则。
- 结果：根版本与常规 README/使用说明改为 1.1.1；当前 Skill 随新候选入包，离线附录明确历史 1.1.0 整包。HAPI 和工作流保持原配置。
- 验证：bun run typecheck、bun run test、bun run build 与网站构建通过。265 项本地根测试全部通过，5305 断言、43 文件，无跳过/失败；dist/runweft --version=1.1.1。常规说明/八个静态文件无旧版本，安装/Agent 对话为 1.1.1；历史附录仍为 1.1.0。原公共 1.1.0 五包另以原冻结 manifest/hash 通过现有 registry 校验器。
- Commit：`npm-patch-release T1: prepare verified 1.1.1 release inputs`

## T2 正式可信发布并匿名验收

- 结果：v1.1.1 固定指向 36257dfb3aae2da85289539b11ba8ac857bdbb10；原 tag run 36915690489 成功，四平台安装/服务、五包 OIDC HTTP 201 和真实 publication success=true、五包 confirmed。公共五包 latest=1.1.1，元数据、精确依赖、实际下载 SHA-512 与原候选一致。
- 验证：标签事件为 push，源码/候选/回执匹配；原候选索引/五份 manifest 通过归档范围读取，477MB 原候选仍保留在 run，不重建。匿名 Linux x64 安装执行真实 DOM 命令，程序/HAPI hash 匹配，HAPI=0.30.7，Skill 六文件与两包 README 匹配冻结源码；11 项网页检查、19 个布局、24 个子路径链接通过，零网页/网络错误。根 CI 263 pass、2 skip、0 fail、5282 断言、43 文件；两项跳过因托管 runner 无 Codex CLI。
- 环境：慢代理安装已停止并保留失败现场；在专用配置/prefix/cache 下改用可达直连完成同一 npm 命令，用户全局配置未修改。公开 tarball 的短暂 404 缓存仅等待传播，未重发上传。
- Commit：`npm-patch-release T2: verify trusted publication and anonymous installation`

## T3 推送 main 并部署生产官网

- 结果：待推送已公开的 1.1.1 输入及验收记录；Beta 仅有已评审 Plan，尚未实施。
- 验证：推送前 packageInputs 与 v1.1.1 无差异；等待 main CLI/Pages 和公开生产检查。
