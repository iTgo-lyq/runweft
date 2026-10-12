# 接入方案

## 工作流与历史

固定 SpecTrail 上游提交 67984848b4b3248cddc1dd0258dfba55d1a2ff6f，完整复制主 skill、setup、prototype、共享脚本和测试，不分叉规则。main 为本项目守护分支；GitHub 当前 main 没有服务端分支保护，此配置是项目约定。仓库维护 `.githooks/pre-commit`，本地显式启用 core.hooksPath，CI 对仓库全部 Change/Workflow 运行共享校验。

历史迁移是用户授权的一次性勘误，不构建产品迁移框架。迁移脚本与逐项证据留在本 Change 的 research/迁移记录；临时执行器放 `.dev-smoke/`。从原 Plan 读取任务定义与完成状态，从原归档提交固定内容和证据。JSON 摘要注明回填依据，记录可追溯的 Git 提交时间，不冒充当时测试/确认的准确发生时间。无法确定的确认不虚构。保留现有规模，缺失的 large Review 仅汇集当时评审来源及本次迁移复核，不声称补做了产品验收。

保留合法任务编号；T4b、T4.1 等映射到未占用的正整数编号，同步该 Change 的引用，并在 Plan 唯一执行顺序表保存原交付顺序。Markdown 移除流程状态字段和勾选标记，保留验收标准与结论正文。用户已搁置的 release-throughput 保留 active 和 waitingFor.pause；在专属 codex/release-throughput 分支保存后，从交付分支移除，避免将未归档 Change 带入主干。

## 独立原型

HAPI 已提供真实会话、审批和文件 UI；此次仅提取 Runweft 自有 Hub 页面，不复制 HAPI 执行或原生 UI。已有页面主体、样式和组件以当前提交为基线复制到私有原型包。宿主负责路由、内存 mock、示例场景和就绪桥接，构建不能导入 Runweft 后端或访问运行中的 Hub。身份入口只接受显式示例 token，原生会话入口显示示例说明。

每个原型入口输出自包含 HTML，CSS/JS 全部内联，hash 保留导航，适配不透明 iframe；不访问存储、真实接口或外部资源。DESIGN.md 从当前 Hub 色彩、字体、布局、断点和状态抽取，不引入新设计系统。构建使用现有 Bun，原型包单独声明发布依赖，避免影响 Runweft 运行产物。

## 发布与验证

复用 open-folio 的 R2 适配器并修正本仓库路径，固定前缀 `runweft/<requestId>/`；凭据通过本机现有配置注入，不复制到 Git。Standard 对象条件创建，已存在时校验字节和 MIME，所有匿名读校验通过才生成成功结果。截图在 prepare 前生成并计入 digest，源码先提交，工作区干净后构建发布。使用 SpecTrail 原生 prepare/register/validate/archive 命令记录引用与保留标签。

验收覆盖 39 个历史状态、任务编号/文档链接/来源，临时仓库真实 hook 成败，原型各入口和三种设备关键交互、错误/空态及 ready 握手，R2 适配器既有失败路径测试和真实匿名读取。基础检查运行 bun run typecheck、bun run test、bun run build；最后用独立 iclaude 复核差异和证据。归档按已有自动验收授权记录真实方式。合入主干或 PR 以用户已有选择为准，归档本身不推定用户批准合并。
