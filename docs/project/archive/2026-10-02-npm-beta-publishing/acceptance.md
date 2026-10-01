# npm Beta tag 发布配置验收

按用户持续授权完成自动验收，配置目标已交付。原五包可信工作流、权限与 Secrets 保持；程序版本仍为已公开的 1.1.1，未额外发布 Beta。

| 需求 | 可观察证据 |
| --- | --- |
| 标签与通道 | 同名规范 stable/Beta tag 门禁共用 Node-only 函数，stable → latest、Beta → beta；不匹配/非数字 Beta/alpha/rc/前导零拒绝，普通 push/manual 不上传。17 项发布测试及 Node 24 Beta 源夹具门禁通过 |
| 前进与 latest 保护 | Beta 同时检查 beta/latest，stable 仅检查 latest；数值序号与 stable 优先比较。回执保留 channel/latestBefore/distTags，实际 latest 变化、跨通道恢复和通道被推进均明确失败，不自动修正标签；聚焦模拟通过 |
| 候选、顺序与恢复 | 原五包精确依赖/完整性、四平台前置、平台先于主包、未知上传停止与原候选恢复继续使用；稳定与 Beta 的顺序、部分恢复和冲突测试通过。两条真实四平台 CI 均通过 |
| 官网 | Beta 仅在 codex push/dispatch 跳过构建/准备/上传/静态产物，main/PR 的 Beta 失败。14 项 Node 测试在稳定与专用 Beta 源环境均通过；真实 main 仍部署稳定 1.1.1、八文件摘要/MIME 匹配已验收内容 |
| 工程交付 | typecheck、274 项本地根测试（5391 断言、43 文件、零跳过/失败）、actionlint 与实际 npm Beta dry-run 最小包夹具通过；维护者操作文档、当前 Specs 和本地/远端边界同步 |

[CLI CI](https://github.com/iTgo-lyq/runweft/actions/runs/36921038282)、[npm CI](https://github.com/iTgo-lyq/runweft/actions/runs/36921038560)和[官网 CI](https://github.com/iTgo-lyq/runweft/actions/runs/36921038133)均来自配置源码 492bda5bbc1a4b5befe16215347b4cbd1843f14e。五包 OIDC HTTP 201；原预演回执 version=1.1.1、channel=latest、success=true、published=false。根 CI 272 pass、2 skip、0 fail、5369 断言、43 文件，两项跳过因无 Codex CLI，本地已执行。

文档提交 bd7f137a3773eb0ebf457830040f12d8d057ad15 的[追加生产 CI](https://github.com/iTgo-lyq/runweft/actions/runs/36922124955)也成功，原回执、固定 URL 和正式域名八文件校验通过。公共五包完整性/latest=1.1.1 保持，无 beta tag；原 1.1.1 匿名安装/三页 Playwright 内容未变化。完整脱敏证据见 [verification.json](verification.json)。

未取得真实 Beta tag/workflow、完整 Beta 四平台候选或公开上传；Beta 门禁、beta npm 参数 dry-run 和官网跳过仅有专用本地夹具证据，新版正式上传后的通道/标签回执仅聚焦模拟。真实 main CI 只验证稳定预演，不能当作 Beta 已公开。没有新的模型/物理跨机验证，也没有修改包内使用说明、Skill、HAPI 或历史交付。

逐任务提交并推送 main，独立工作区保持干净；原工作区的并行 module-slimming-audit 调查文档不纳入本次提交。
