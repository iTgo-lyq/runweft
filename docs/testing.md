# 测试与需求验收

## 按改动选择检查

在仓库根执行；比较前先 fetch 所需分支，显式参数引用必须在本地可解析。

```sh
node scripts/ci-scope.mjs --base origin/main --head HEAD
node scripts/ci-scope.mjs --base origin/main --head HEAD --working-tree
```

输出比较提交、文件清单、固定检查和依赖范围。`--working-tree` 额外纳入已暂存、未暂存及未跟踪文件；重命名同时考虑旧、新路径。比较分叉分支可加 `--merge-base`。明确基线不存在会失败，不能把失败当成“无须测试”。

开发 CI 在 Node 环境先选择范围，再安装所选检查需要的依赖。PR 使用目标分支 merge-base，普通 push 使用 before/head，首次 push 使用默认分支 merge-base；缺少可信自动基线保守选择完整检查。scope 与最终汇总始终执行，所选检查失败、取消或缺结果不能通过。

普通文档执行文档与流程检查；未初始化 HAPI 时会明确列出未检查的外部源码链接，产品检查准备 pin 后再核验它们。原型和官网使用所属工程的验证，Kit 检查结构及分发工具。根测试、公共 helper、共享源码和工作流变更不会因被排除而漏验。`native` 是按改动给出的模型验收建议，开发 CI 不会自动调用模型；`install` 表示候选安装的影响范围。`integration` 给出实际文件，`build/clients/browser/managers` 说明所需前置；范围输出不代表检查已经执行。

官网的验证与部署由其独立工作流负责，入口见 [官网说明](../website/README.md)；原型见 [包内说明](../packages/prototype/README.md)，候选、发布和恢复见 [发行操作](release.md)。

## Hub 配置接线

已构建匹配的 CLI/HAPI 后，可单独验证 CLI 到真实 Runner 的配置解析；只做版本发现，不调用模型。它自己创建并关闭本次环境，无需预先启动服务。

```sh
bun run test:integration --bin dist/runweft -- ./test/integration/hub-configuration.test.ts
```

断言通过且 owner hook 确认关闭后才通过。未传程序、缺少原生 Codex 程序、超时或关闭失败会失败；停机未知时保留现场，不能把开始运行或打印 ready 当作成功。

## 固定检查

`bun run test` 只执行 `test/core` 的格式拒绝、并发建库和资源关闭保障；不编译 CLI 或启动服务。`bun run test:tools` 执行 Node 工程工具契约。跨模块检查在 `test/integration`，通过一个 Bun 进程直接使用原生过滤和分片：

```sh
bun run test:integration --bin dist/runweft --
bun run test:integration -- ./test/integration/tasks.test.ts -t 'lost'
bun run test:integration --bin dist/runweft -- --shard 1/4 --timings /tmp/runweft-timings.json --update-timings
```

CLI 替身检查未传 `--bin` 时本次共享编译一次；真实 Hub/Runner 检查必须显式提供配对程序。默认单项超时 120 秒，较长 Git 场景在文件中声明；`--timeout`、`--timings`、`--update-timings`、`--shard` 直接交给 Bun。空选择不能作为通过证据。失败先查看具体用例和清理结果，再定向执行文件或名称；不自动整组重试。

## 候选安装验收

安装、打包、launcher、服务启动/退出、MCP 安装或卸载变化时执行。先将包输入提交到干净版本，再构建：

```sh
bun run package --reuse-hapi
node test/acceptance/install.mjs --candidate dist/packages --case all --report /tmp/runweft-install.json
```

`npm` 与 `standalone` 可单独复验；`all` 顺序运行两种布局，每种拥有独立安装根。输入 tarball/程序摘要、版本和平台必须一致，不自行重建候选；Node 驱动在 checkout 外、无 Bun 的 PATH 下运行已安装程序，确认服务退出、MCP 配置保全和完整卸载后才通过。`--report` 保存每个布局的结果及清理失败；未知停机保留根目录，不能当作通过。

本地只证明当前平台。开发 CI 在安装相关范围选择四平台各自构建与实际安装；发行 CI 对四平台各自下载的公共候选执行同一入口。HAPI 源码归档与 pin 的逐文件比对由打包阶段负责，不在每个安装进程重复准备源码。

## 浏览器与原型

Hub 页面变化选择 `web-identity`、`web-connect`、`web-console` 集成：真实身份/加密连接、配置选择、任务到原生详情，保留跨 owner 隔离、撤权失效和秘密扫描。普通任务历史是当前格式样本；真实模型历史在原生 case 内验证，不能用普通浏览器样本代替。

```sh
bunx playwright install chromium
bun run test:integration --bin dist/runweft -- ./test/integration/web-console.test.ts
node website/build.mjs
node website/verify.mjs --browser-only
(cd packages/prototype && bun run build && bun run test)
```

官网三页各检查桌面/手机两档布局、版本命令、复制/键盘、图片和本地链接。仅正式发行验收才加公共 npm 的实际 DOM 安装（不传 `--browser-only`）；独立 Kit 安装不在官网重复。原型八入口各检查桌面/手机、opaque iframe、无外部请求、导航及代表性交互，不复演内存演示业务。失败按文件/入口定向复验，无需部署或真实用户浏览器。

## 灵活验收前置环境

需要围绕当前需求手动操作 CLI/API/浏览器时，先准备环境，再执行自己的业务步骤。它不运行测试、不准备 Agent 或模型配置，也不产生业务通过报告。

```sh
bun run dev:env start --bin dist/runweft
bun run dev:env start --candidate dist/packages --runner
bun run dev:env stop --dir /返回的/runweft-env-目录
```

`--bin` 使用显式程序及其相邻 HAPI 的私有副本；`--candidate` 使用已校验的候选私有安装。两者必须二选一，不自动编译或换包。默认只有 Hub，`--runner` 才登记并启动 Runner；身份和个人空间已准备好，返回 `identityFile` 供需要时读取并导入浏览器，不在终端打印 token。`cli`、`home`、`nativeHome` 分别说明专用程序、Runweft 数据与原生配置位置；后续命令带 `--home` 使用返回的数据根。

启动命令退出后环境仍可使用。完成业务验收后运行返回的停止命令：核对目录/程序摘要和现有产品进程状态，活跃会话、MCP 客户端、未知进程或未确认结束的任务会拒绝删除并保留目录。先用此环境的 CLI/原生会话入口结束任务、修复状态，再定向停止；不猜 PID 强杀。确认全部进程退出后删除本次专用目录，重复停止已删除目录是空操作。业务结果需要留存时先保存到环境外。固定测试自行准备和清理，不调用此入口获取现场。
