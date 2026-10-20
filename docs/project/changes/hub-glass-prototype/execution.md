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

## 2026-10-19 R2 在线发布

用户明确要求将本版原型发布到现有 R2，并指定已有 OpenFolio 发布环境。使用该环境注入凭据，没有复制、输出或提交密钥。以干净且已推送的源码提交 `092296356840ef5ed7ff4cda4109226864df7bc8` 重新构建，24 组三尺寸原型交互与截图检查通过。

发布版本：`b149b044b09411002b131c5b1f80eca821e0d8980ae4d6366f28c8b5bc137dc3`；产物摘要：`sha256:2d2c434bd2be7bce0a995e8b83445e250f047830533a8f239e54a53c417cb4fd`。已有 R2 适配器以条件写入上传 36 个对象，逐一通过匿名读取、完整内容与 MIME 校验；旧版本未覆盖。保存的同一 request/result 完成清单与 Change 固定引用登记。

[在线原型：任务入口](https://pub-cc623a99ce8e4606a3491cc2d4b4436c.r2.dev/runweft/b149b044b09411002b131c5b1f80eca821e0d8980ae4d6366f28c8b5bc137dc3/tasks/index.html)。八个独立入口均通过 Chromium 沙箱加载验证；在线桌面 1440×1000、平板 834×1112、手机 390×844 的搜索、任务详情、轮次切换、附件预览与 Agent 导航通过，无溢出或浏览器错误。受限 iframe 的 ready 握手返回该固定版本。此次为原型托管发布，不代表用户已完成视觉验收或已部署产品功能。

## 2026-10-19 升级为大型前端重构

用户指令：“现在要升级这个 change 为前端交互样式重构的大型 change”。沿用原 ID、分支与 worktree，标题调整为“Hub 前端交互与样式重构”。通过语义命令返回 requirement 并设为 large，清除仅原型范围的需求/技术/计划确认、整体验证结论和等待；T1 的完成内容及八个 R2 固定引用与升级前完全相同。

重写 Requirement、Technical 和 Plan，补充 Review；新增 T2–T8，覆盖真实应用壳、身份/空间、任务、机器/Runtime、Agent、仓库/选择及成员。当前只完成范围与流程升级，新产品任务均未开始；真实接口、产品视觉和后续 large 全量验收没有执行。本轮没有将用户的规模升级指令补记为新版详细需求或原型验收。

现有 SpecTrail 缺少规模修改命令，依其约定为 rework 增加受限的 `--size`：仅非 xlarge 返回 requirement 时可选 small/medium/large，保留已交付任务与原型，并沿既有返工规则清除失效确认。不新增任意字段修改入口，不隐式转换父子结构。使用该命令完成本次升级。

实际检查：新增状态命令测试 7/7，hook/setup 回归 12/12，Skill 结构校验及文档/工作流/diff 检查通过。完整工具测试首轮因本 worktree 缺少锁定的 yaml 依赖失败；以 Bun 1.4.2 执行 frozen install 后，仅对失败的 npm-release、release-finish、skill-sync 三个文件定向续验，31 项通过，其他首轮通过项未无故重跑。

上下文隔离的独立 Agent 已只读核对本轮升级差异、命令测试与状态保留，未发现需修复问题，范围与局限见 Review。该评审不替代未来产品实现结束后的独立评审。

## 2026-10-19 回滚实施计划，改为原型先行

用户指令：继续使用本 Change，当前分支上的修改仅供参考；结合 shadcnuikit 的布局思路，保持蓝色主题并克制地采用液态玻璃，风格参考 Craft；回滚预定的实施计划，先完成原型设计并等待验收，再梳理前端重构技术方案。

已按当前 develop 的 Hub 重写 Requirement，用 rework 记录本次调整，并删除 Technical 与 Plan 草案（Git 历史保留）。T1 及其固定引用不变。SpecTrail 现有命令不能删除未开始的任务，经用户授权（“允许你直接改 json”）直接编辑 change.json，删除未开始的 T2–T8；编号不复用，后续任务从 T9 起。本分支落后 develop 50 个提交，绘制原型前先同步。

本轮只修改文档与流程状态，未改动原型或产品代码。

## 2026-10-19 原型设计交付

需求确认后，把最新 develop 合入本分支，原型包以 develop 为基线。分支上此前的蓝色轻玻璃实现只作参考，保留在 Git 历史和固定 R2 版本中。按需求重新设计 8 个入口：账号与首次连接、任务、机器、Runtime、Agent、仓库、我的选择、成员；原 `identity` 入口并入工作台侧栏。没有修改 `src/hub`、HAPI 或官网。

视觉与交互规范写入[原型 DESIGN](../../../../packages/prototype/DESIGN.md)：冷调中性框架与蓝色强调、只在浮动控制层使用的玻璃、浅色与深色两套令牌、列表与检查器、就地编辑、轮次“纬线”。shadcnuikit 读取了 `dashboard-shell8`、`tables19` 源码与 `apps/mail`、`project-detail` 页面结构，空态、账号与成员只按目录说明对照；没有安装或复制其 React 源码。界面按当前 Specs 表达产品事实：账号不出现 token 流程，用户名和密码不设长度规则；任务筛选只用现有服务端参数，“在本页查找”写明范围；不显示全量状态统计；“执行未确认”有独立颜色和图标，不提示重发；权限差异通过演示角色切换展示。

### 实际验证

- `bun run build`：8 个自包含入口构建成功。
- `node --test publish-r2.test.mjs`：10 项通过。
- `CI=true bun run test`、`CI=true bun run screenshots`：24 组入口流程（8 个入口 × 桌面 1440×1000、平板 834×1112、手机 390×844，平板和手机使用触摸）全部通过，另存 48 张浅色与深色截图。每组都检查不透明 iframe、ready 握手、无外部请求或存储访问、无横向溢出和浏览器错误，并覆盖各入口的主要操作和失败路径。另一组桌面检查覆盖空数据、首次加载失败、刷新失败保留内容、离线时写入结果未确认、登录过期后回到原页面、对话框和检查器关闭后焦点回归、方向键在列表中移动、外观切换，以及减少动态效果和减少透明度（本机 Chromium 支持这两项模拟）。
- 本机 Chromium 无法启用进程沙箱，按包内说明使用 `CI=true` 运行；iframe 权限仍仅为 allow-scripts。
- 人工查看了桌面、平板、手机的浅色与深色截图，以及任务、Agent、机器、Runtime 检查器的展开状态。发现并修复了：空值被渲染成文字、本页查找框样式被通用输入样式覆盖、平板检查器遮住列表时的操作路径、关系线在行尾断开、轮次间距过大、窄屏标签缺少底色。

### 与当前 develop 原型对照

左侧为合入前 develop 的原型，右侧为本次原型，均为同一入口打开后的首屏。

| 入口 | 主要变化 | 桌面 | 手机 |
| --- | --- | --- | --- |
| 账号与首次连接 | 与工作台使用同一套视觉；核对码单独突出，手机上先显示；按当前 Spec 去掉用户名和密码长度规则；账号设置移入工作台 | [对照](assets/compare/account-onboarding-pc-web.jpg) | [对照](assets/compare/account-onboarding-mobile.jpg) |
| 任务 | 状态分段筛选，其余筛选收进弹出层；列表与检查器并排，不再替换列表；轮次用纬线切换；报告分段阅读；交付、详情与继续处理分标签 | [对照](assets/compare/tasks-pc-web.jpg) | [对照](assets/compare/tasks-mobile.jpg) |
| 机器 | 表格式列表加检查器；空间关联改为带确认的开关；凭据和取消登记收进菜单；非本人机器只显示概要 | [对照](assets/compare/machines-pc-web.jpg) | [对照](assets/compare/machines-mobile.jpg) |
| Runtime | 可用性和不可用原因直接显示；共享按空间开关，未关联机器的空间不可开启；检查结果写明未检查模型认证 | [对照](assets/compare/runtimes-pc-web.jpg) | [对照](assets/compare/runtimes-mobile.jpg) |
| Agent | 定义以阅读形式呈现，在检查器内就地编辑并提示将生成的版本；版本历史和分享独立成标签；他人私有 Agent 只显示治理概要 | [对照](assets/compare/agents-pc-web.jpg) | [对照](assets/compare/agents-mobile.jpg) |
| 仓库 | 别名可添加和移除并校验地址；本人 checkout 只读展示；登记改为对话框 | [对照](assets/compare/repositories-pc-web.jpg) | [对照](assets/compare/repositories-mobile.jpg) |
| 我的选择 | 解析顺序用纬线展示；每条选择显示有效或需要处理及原因；解析预览给出来源层和失败原因 | [对照](assets/compare/selections-pc-web.jpg) | [对照](assets/compare/selections-mobile.jpg) |
| 成员 | 空间名称就地编辑；角色操作按权限收进菜单；邀请只显示一次；最后一位所有者的限制提前说明 | [对照](assets/compare/members-pc-web.jpg) | [对照](assets/compare/members-mobile.jpg) |

### 交付方式与边界

本机没有配置 R2 发布凭据，本次没有上传 R2，也没有改变项目的 custom/R2 托管策略。按 SpecTrail Git 兜底，从已推送的源码提交 `476b858` 用 `bun build.mjs --git-preview` 生成 8 个自包含 HTML 快照，逐个 `publish.mjs register --git-entry <id> --change hub-glass-prototype` 登记到原型清单和本 Change 的 previews；旧的 `identity` 预览已从本 Change 移除。快照与通过验证的构建输出逐字节相同。SpecTrail 的 `validate.mjs` 静态检查通过；其浏览器检查固定启用 Chromium 进程沙箱，本机无法运行，等价的受限 iframe 检查已由 `verify.mjs` 在同一输出上完成。`bun run dev` 可在本机预览全部入口。另把同一份 `tasks` 构建（`476b858`）发布为私有的 claude.ai 预览页 [Runweft Hub 原型](https://claude.ai/artifact/WV5mxRngneQbETJNrPUvRR)，供用户验收时直接打开；它只是便于查看的副本，不随源码自动更新，所有入口都可从页内导航和“演示”进入。原型只证明界面与交互设计，不代表真实接口、权限执行或模型执行；示例版本、哈希和路径都是虚构的。需要用户验收原型后，才开始编写产品重构的技术方案。

### R2 发布与本地配置补充

按用户要求，将源码 `fc9cd7f` 的八入口原型和 48 张浅深色截图发布到 R2，上传后逐文件匿名读取校验字节及 MIME，固定引用已登记并推送（`6ca4b41`）。24 组入口交互和 hosted 浏览器检查通过。

用户随后要求在本 Change 工作区补充 `.env` 与 `.env.example`。根目录 `.env` 仅保存从 open-folio 复用的五项 R2 配置，权限为 0600，Git 忽略；公开模板不含凭据。发布 CLI 按脚本位置读取根目录 `.env.local` 和 `.env`，进程环境优先，显式空值不回退；只读取 R2 字段，不修改进程环境，不增加依赖。发布说明改为直接运行 CLI，无需额外注入配置。

`node --test packages/prototype/publish-r2.test.mjs` 的 12 项测试通过，覆盖配置优先级、字面密钥、缺失及不可读配置文件、不可变上传、失败回执与凭据脱敏。本次仅调整上传配置，不改原型页面；无需重新发布已验证产物。

## 2026-10-19 原型验收

验收期间按用户反馈调整了玻璃效果，每轮都从已推送提交构建、发布 R2 并登记：

| 反馈 | 处理 | 提交 |
| --- | --- | --- |
| 顶部玻璃不够透，确认是否为 Apple 最新做法 | 对照 [Meet Liquid Glass（WWDC25）](https://developer.apple.com/videos/play/wwdc2025/219/)：小控件更薄、不着色；工具栏改薄玻璃 | `38ac957` |
| 空间切换与用户选项没有玻璃效果 | 两个按钮改薄玻璃、菜单加厚；用户看后认为更丑，整体回滚 | `f5abb27`，回滚 `058ff80` |
| 顶部导航参考 Craft 实测样式 | 工具栏改为 40%→80% 白渐变、4px 模糊、遮罩高光描边、双层阴影、52px 胶囊 | `9c8daa7` |
| 深色没有优化 | 深色用同一结构，底色取略亮的深灰 | `9e32488` |

`f5abb27` 同时把截图改为 SwiftShader GPU 合成：无头 Chromium 的软件渲染不会对带圆角的元素做背景模糊，缩略图会比真实浏览器更不透明（在侧栏同一位置叠加带圆角与不带圆角的模糊层对照：软件渲染下只有后者生效，GPU 合成下两者都生效），这项保留。

最终版本：源码 `9e32488`，R2 版本 `6585f1b8…`，登记提交 `7e88b95`，[任务入口](https://pub-cc623a99ce8e4606a3491cc2d4b4436c.r2.dev/runweft/6585f1b84a54da747a6b72ae5cfb53540520834b6c1d76eaa6d2112662e4302f/tasks/index.html)。发布前 `CI=true node verify.mjs` 的 24 组入口流程和场景检查通过，`node --test publish-r2.test.mjs` 12 项通过；发布后 8 个入口从公网读回与本地构建逐字节一致。

用户验收原话：“行了，原型验收结束了。接下来准备正式的前端样式和交互重构方案。”
