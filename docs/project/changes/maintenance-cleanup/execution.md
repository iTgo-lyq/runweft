# 清理依据与验证

## 方案审查

iclaude 一次只读综合审查成功（session `01d3b8a1-8f79-4590-8e39-95c7387f05b5`，约 11 分钟），读取了本 Change 计划并核对实际调用和覆盖。未再次调用，未运行产品模型或外部发布。主要取舍：

- 采纳删除离线组装、QEMU 及只被测试调用的 isRelease；版本格式反例改测仍在使用的 releaseChannel。
- 采纳合并 smoke-hub-service 与 smoke-service，但先迁入凭据撤销/轮换的编译 CLI 回归；清除 smoke-inputs 无调用的 source/model 分支，保留真实大文件/输入复制/重启回执检查。控制、重建和原生主链保留。
- 采纳辅助探针归 fixtures、Specs 按能力合并、当前链接修正及归档固定引用。
- fixture-cleanup 的失败注入能发现正常 afterEach 无法覆盖的资源泄漏，因此保留这一保护，删除重复外层资源检查及依赖构造 BigInt 错误的测试。smoke-lifecycle 的进程/凭据清理保护继续保留。
- 文档校验独立于 SpecTrail 状态校验，避免工作流与 Markdown 解析互相耦合；使用现有 CI 入口直接执行。临时夹具已验证中文、重复标题、空格路径、代码块忽略、缺文件/锚点非零退出。
- 采用 18 份 Specs；委派入口与其轮次规则内聚，Git 生命周期与工作区内聚；执行授权、远端基线保留子能力。MCP 安装归安装能力，宿主身份协议归 host-mcp，保留必要跨能力引用。
- usage 的历史 1.1.0 离线附录退出当前手册，官网直接转义完整正文；当前平台 tarball 安装能力仍保留在安装规格。已生成历史整包不删除，下次发行须重建文档/package.json 变化后的包。

## 临时内容归宿

初始 `.dev-smoke` 为 327 个普通文件、2 个符号链接、2,316,781,795 字节。清理前不跟随符号链接检查；当时只有本轮 iclaude 持有目录内日志。

- developer-docs/check-links.py 的通用部分沉淀为 scripts/check-docs.mjs。
- npm-uninstall-release 的固定版本/npm/网页/匿名安装核对和 CI 摘要，已有 npm-release、website/publish、website/verify、四平台 cli-install 与包内容校验；不再保留写死版本、run ID 和浏览器路径的脚本。
- SpecTrail 历史迁移与依赖审计是一次性动作；托管原型字节和沙箱交互已有 publish-r2、prototype/verify 与上游 validate 入口。
- 旧包备份、测试安装、DOM 生成命令、截图和日志均为临时产物；本轮脚本草稿和评审日志同样在完成后删除，结论留本记录。

## T1 工程工具收敛

删除三个历史入口（离线组装、QEMU、重复 Hub 服务冒烟）及离线组装测试；isRelease 及旧事件判断测试退出，版本语法反例保留。fixture-cleanup 保留真实 HTTP/SQLite/目录失败清理用例，移除两项重复/构造错误测试。输入冒烟删去未被正式入口使用的模型分支。task-results-probe 与 MCP 安装 helper 归入 fixtures，服务独有的撤权/轮换检查迁入统一服务冒烟。

临时链接检查已沉淀到 scripts/check-docs.mjs，独立接入 CI 和 AGENTS 常用检查；当前文档查路径/锚点，归档只查本地目标。7 处历史脚本链接固定到 d7bc66b9ffd7c4c07fbb940280424b11feffc58a，反向还原逐字等于原文，Git blob 存在。

实际验证：

- `bun run typecheck`、`bun run build` 通过；HAPI pin 和程序匹配。
- `bun run test`：257 pass、0 fail、4838 expects，41 文件，64.14 秒。
- Node 脚本/官网测试：42 pass、0 fail。
- `node scripts/smoke-service.mjs dist/runweft`：7 组通过，含迁入的凭据撤销/轮换/同机重启；清理无错误。
- `bun run test:integration storage dist/runweft`：11 个实际 HAPI/Runner、文件/Git/任务探针全部通过，含精简后的 72 MiB 输入复制/回执恢复与迁移的代码成果 helper。
- `bun scripts/smoke-hub-resources.ts dist/hapi dist/runweft`：10 组通过，含迁移的真实原生 MCP 编辑/目录、撤权、重连及 45 秒心跳过期；清理无错误。
- 官网构建和 `node website/verify.mjs --browser-only`：14 组浏览器检查通过；明确跳过公共 npm 安装，不新增平台或模型证据。
- 文档检查：340 文件、917 本地链接、0 错误；中文/重复标题、空格路径、代码块、当前锚点及归档失效路径的临时夹具通过。工作流 43 Changes 与 diff 检查通过。

未重新打四平台发行候选、运行公开安装或产品模型；上述实际服务使用当前编译 CLI。usage/package.json 变化使旧候选失去复用资格，下次发行应重新冻结构建。原生脚本本体未变；fixtures 路径变化会正常使旧原生验收指纹失效，不能自动复用旧 ledger。

## T2 规格收敛

50 份 Specs 合并为 18 份；Agent、资源、身份、委派、文件、代码成果等各能力集中定义，Git 归工作区，远端基线与执行授权保留子能力。正文约减少 15%，Markdown 链接由 135 降至 68；移除能力内重复说明和历史构建数字，保留独有参数、权限、恢复、数据格式与清理边界。验收矩阵、命令和历史证据入口归 docs/release.md，网站开发说明去掉重复的历史部署数字与布局说明。

当前入口已修正；5 份历史文档中的 8 处旧 Spec 链接固定到 d7bc66b9ffd7c4c07fbb940280424b11feffc58a，反向替换后逐字等于原文，全部 Git blob 存在。首次部署基线锚点继续有效。原文所有行内技术标识已对照，退出的仅为历史版本/hash、离线产物、重复命令或已改写的命令展示；模型未检查状态等独有边界已保留。

实际验证：308 份文档、847 个本地链接、0 错误；43 Changes 与 diff 检查通过。相较用户 AGENTS 提交，src、HAPI、原型、产品 Skill 和工作流 Skill 无改动。本任务仅改文档，沿用 T1 工程验证，不重复启动模型或全套测试。
