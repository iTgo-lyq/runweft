# 原型交付记录

T1 仅交付独立原型，未修改 src/hub、HAPI、产品配置或模型凭据。保留八个入口，重新设计应用壳、任务列表与抽屉详情、资源卡片、默认选择、成员与身份管理。所有更改仅保存在内存。新的视觉规范与源码对应关系已同步到包内 DESIGN.md 和 README。

使用 Bun 1.4.2 与固定 lockfile；独立包不加入根 workspace。新增本机预览入口 `bun run dev`，仅监听 127.0.0.1，提供自包含 HTML 与隔离 CSP。shadcnuikit 的候选与适配范围见 Requirement 和 DESIGN；没有引入 React 框架或伪称安装其组件。

## 实际验证

- `bun run --cwd packages/prototype build`：八个自包含入口构建成功。
- `CI=true bun run --cwd packages/prototype test`：10 项不可变发布工具测试、24 组桌面/平板/手机入口交互通过。
- `CI=true bun run --cwd packages/prototype screenshots`：最终 24 组截图与交互通过，额外提供三尺寸任务详情截图。手机启用真实触摸与移动设备模拟，并断言 iframe 内的实际宽度等于声明尺寸。
- 浏览器覆盖：任务搜索/无结果/筛选、详情/轮次/记录/附件、全局搜索、资源编辑与 Agent 创建、邀请/撤销、身份改名、创建空间、空间切换、默认 Agent 与配置预览、空态/离线/错误恢复。所有页面均无外部请求、存储访问、横向溢出或浏览器错误，并通过 opaque iframe 与 ready 握手检查。
- 已查看三尺寸八入口截图总览，以及桌面任务页、详情抽屉的原始截图。阅读区保持实底；侧栏、切换器、选中控件与浮层使用克制的蓝色玻璃效果。
- `node scripts/check-docs.mjs`、`node scripts/check-workflow.mjs`、`git diff --check`：检查通过。HAPI 未初始化的外部源码链接按现有检查器说明延后，原型不依赖其构建。

首次检查发现测试查询“文档”同时匹配了任务与 Agent 名称，已使用明确关键词验证搜索；受限 iframe 不允许 autofocus，改为用户操作后的显式 focus。触摸模拟进一步发现测试宿主页缺少 viewport meta，已补齐并断言实际尺寸后重新验证。手机隐藏导航采用 visibility 隔离键盘焦点。

## 交付与边界

当前机器没有配置 R2 发布凭据，未尝试上传或覆盖原有托管版本。本次明确采用 Git 中的自包含 HTML 固定快照作为原型交付，登记本 Change 的八个固定引用；不改变项目既有 custom/R2 托管策略。另提供本机预览与可独立打开的单文件，所有八个页面可通过导航切换。

本次验收仅证明原型交互与视觉实现，不代表真实 Hub 接入、真实模型执行或产品功能验证。等待用户评审后再决定后续产品改造；没有记录用户已验收，也不自动合入 develop 或 main。
