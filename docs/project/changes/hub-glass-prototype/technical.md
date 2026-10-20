# Hub 前端重构技术方案

依据[需求](requirement.md)的产品重构阶段：按已验收原型重做 Hub，并建立长期维护的自有 UI 库。视觉规范以原型包 [DESIGN.md](../../../../packages/prototype/DESIGN.md) 为准。技术 Q6 已选定 React + Radix/shadcn + Tailwind，技术 Q7 已选定原型独立实现页面。

## 现状

| 事实 | 依据 |
| --- | --- |
| Hub 浏览器端由静态骨架 `page.html`、46 行 `style.css` 和 7 个 TS 模块（约 1500 行）组成，命令式 DOM 操作；页面以 type-only import 复用服务端类型，如 `TaskOverview`、`AgentView` | 已验证：`src/hub/*.ts` |
| `page.ts` 在请求时用 `Bun.Transpiler` 逐个转译模块，不打包；CSP 为 `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'` | 已验证：[page.ts](../../../../src/hub/page.ts) |
| 交付物是 Bun 编译的单二进制，页面资源以文本导入嵌入；集成测试使用 `dist/runweft` | 已验证：`scripts/build.ts` |
| 原型包约 2700 行原生 JS：`h()` 组件、CSS token、内存接口和演示控制，构建为自包含 HTML，运行在 SpecTrail 的沙箱 CSP 下（允许内联脚本与样式，禁止一切网络） | 已验证：`packages/prototype/src`、SpecTrail `html.mjs` |
| 6 个 Playwright 脚本约 100 处按元素 id 选择（`console.ts` 42 处、`console-tasks.ts` 22 处、`web-identity.test.ts` 20 处等） | 已验证：`test/integration` |
| 与 CLI 的入口契约：`/hub#connect=<id>`，`task show` 生成 `/hub#space=…&task=…&round=…`，原生页失效跳回 `/hub#native-expired` | 已验证：`src/tasks/commands.ts:67`、`src/hub/native-page.ts` |
| HAPI 网页使用 React 19.2、Radix 和 Tailwind 4；本次不改 HAPI | 已验证：`hapi/web/package.json` |

## 技术基础（技术 Q6：React + Radix/shadcn + Tailwind）

UI 库按 shadcn 的方式维护：组件源码复制进仓库、归我们所有，交互基础用 Radix，样式用 Tailwind 4，设计 token 用 CSS 变量。这样 shadcn 与 shadcnuikit 的组件和区块可以直接取用后按 DESIGN.md 调整，也与 HAPI 网页同一套技术。

可行性已在临时目录用 HAPI 已安装的同版本依赖实验（Bun 1.4.3、React 19.2.3、@radix-ui/react-dialog 1.1.15、Tailwind 4.1.18、Chromium；仓库固定的 Bun 1.4.2 在实施时复验）：

- `Bun.build` 打包 TSX；Tailwind 4 通过 `@tailwindcss/node` 与 `@tailwindcss/oxide` 扫描源码生成静态 CSS 文件，不需要 Vite 或 PostCSS。
- React 加 Radix Dialog 的生产包约 223KB，gzip 后 72KB。再加上其余组件和页面，预计全部前端资源 gzip 后约 150KB，属推断。
- Radix Dialog 打开后焦点进入，Escape 关闭并把焦点还给触发按钮。

### CSP 的调整（削弱现有保护，需确认）

CSP（内容安全策略）是服务器随页面下发的一个响应头，告诉浏览器这个页面只能从哪里加载脚本、样式和网络请求。Hub 页面持有你的登录会话，能以你的身份创建 Agent、委派任务到你的机器上执行、打开原生会话；页面上又会显示其他成员和模型写的内容，比如任务报告、Agent 定义、成员名和仓库名。万一某处出现注入漏洞，CSP 是第二道防线：注入的脚本不会执行，即使执行也无法把数据发到别的网站。它只是一个响应头，已经在用，保留它没有额外成本，不属于过度设计。

选择 (c) 后唯一的冲突在样式上：Radix 弹窗锁定背后页面滚动时会往页面插入 `<style>` 标签；shadcn 常用的轻提示 sonner 和抽屉 vaul 也会插入，而且两者都不支持 nonce（已核对源码）。用当前 CSP 实测三种写法：

| `style-src` | 弹窗本身 | 锁定背后滚动 | 浏览器报告 |
| --- | --- | --- | --- |
| 现状 `'self'` | 正常 | 失效 | 样式违规 |
| `'self' 'nonce-…'`，每次请求生成 nonce | 正常 | 正常 | 无 |
| `'self' 'unsafe-inline'` | 正常 | 正常 | 无 |

推荐只放开样式：`style-src 'self' 'unsafe-inline'`，其余指令全部不变。理由：

- nonce 只对 Radix 有效，sonner、vaul 插入的样式仍会被拦。要坚持 nonce，就得放弃这类组件，以后每引入一个依赖都要先查它是否插入样式，这个负担长期存在。
- 放开样式后的风险很小：`default-src 'none'` 仍禁止加载任何外部图片和字体，注入的 CSS 无法把数据发出去；脚本仍只能来自本站，内联脚本和 `eval` 仍被禁止。
- 页面内容由 React 按文本渲染，任务报告保持按文本展示，不渲染为 HTML。

因此需求中“不放宽 CSP”改为“脚本、网络连接、外部资源和嵌入限制不放宽，样式允许内联”，随本方案一起确认。

### 依赖与图标

- 运行时依赖：`react`、`react-dom`，按需加入的 `@radix-ui/react-*`、`class-variance-authority`、`clsx`、`tailwind-merge`，以及确实需要时的 `sonner`。构建依赖：`tailwindcss`、`@tailwindcss/node`、`@tailwindcss/oxide`、React 类型声明。全部精确固定在根目录 `package.json` 与 `bun.lock`，只加入实际使用的组件。
- 图标沿用原型自绘的一套，移植为 React 组件，不引入图标库：已验收的视觉用的是这套图标，取用 shadcnuikit 区块时把其中的图标换成对应的自有图标。
- 不引入 CDN、外部字体或运行时网络依赖。
- 浏览器基线为近两个大版本的 Chrome/Edge、Safari 17 及以上、Firefox 125 及以上，以支持 `color-mix()`、`backdrop-filter` 和 Tailwind 4 依赖的 CSS 特性（合理推断，实施时以 Tailwind 官方要求和 MDN 兼容表复核）。

## 原型与产品（技术 Q7：原型独立实现页面）

原型包继续独立实现页面、内存数据和演示控制，只与产品共用 UI 库。原型包内的改动不影响正式前端；UI 库是两边共用的，改 UI 库就是改产品，按产品改动评审。原型为探索而新增的组件或变体先放在原型包里，被产品采纳时再移入 UI 库。

UI 库改用 React 后，原型包需要用 React 加 UI 库重写，仍构建为自包含 HTML，沿用现有发布流程和 `verify.mjs` 检查。

## 代码组织

| 位置 | 职责 |
| --- | --- |
| `packages/ui` | 自有 UI 库：token、组件、交互行为、图标、组件目录页、说明文档，以及 shadcn 配置 `components.json`。仓库内维护，不发布 npm |
| `src/hub/web` | Hub 前端应用：入口、工作台壳、路由、会话与空间上下文、接口层、8 个入口的页面 |
| `src/hub/page.ts` | 继续负责 `/hub` 路由与 CSP，改为提供打包后的单个 JS 与 CSS |
| `packages/prototype` | 原型：独立页面、内存接口与演示控制，使用 UI 库 |

`src/hub/web` 放在服务端代码旁边，页面继续通过 type-only import 使用服务端类型，接口字段变化在类型检查阶段暴露。

### UI 库

- **token**：从原型 `style.css` 提取颜色、表面层级、两种厚度的玻璃（工具栏的薄玻璃，菜单、弹出层与抽屉的常规玻璃）、圆角、字阶、阴影与动效，覆盖浅色、深色、手机纯黑，以及减少透明度与减少动态效果的退回。在 Tailwind 4 的 `@theme` 中映射为 shadcn 的标准 token 名（`background`、`foreground`、`primary`、`muted`、`border`、`ring` 等），shadcn 组件不改类名即可套用我们的配色；玻璃、纬线等自有 token 另行命名。
- **基础组件**：取 shadcn 的按钮、徽标、输入框、多行输入、下拉、开关、分段（toggle-group）、标签页、下拉菜单、弹出层、对话框、确认框、侧边抽屉（sheet）、轻提示，按 DESIGN.md 改样式。
- **Runweft 组件**：工作台壳（侧栏、玻璃工具栏、手机抽屉）、列表加检查器、检查器标题、任务状态徽标、横幅、空态、事实列表、就地编辑、本页查找、分页、纬线与关系链，从原型移植。
- **组件目录**：一个页面展示全部组件及其状态，可切换浅色与深色；同时是组件自动检查的测试对象。
- **文档**：DESIGN.md 从原型包移入 UI 库，成为唯一视觉规范，原型配置改为引用它；README 说明使用方式，以及用 shadcn 命令或手工新增组件、修改组件的约定。

### 数据与状态

- **接口层**：`HubApi` 负责 fetch、15 秒超时、错误映射、空间 JWT 的换取与 14 分钟缓存；页面只依赖接口。
- **会话**：沿用 sessionStorage 键 `runweft.hub.session`，升级后已登录的标签页继续可用。
- **上下文隔离**：身份 token 与当前空间组成上下文。切换时中止进行中的请求，丢弃迟到的响应，与现有 `generation` 检查语义相同。
- **读取**：页面用一个小的资源 hook 读取数据，记住上次成功的结果；刷新失败时保留已有内容并显示错误。
- **写操作**：只禁用当前操作的控件，不再禁用页面上的全部控件。网络失败时提示“结果未确认，先刷新核对”，不自动重试。401 且会话失效时回到登录。
- **创建回执**：`createResource` 的请求 ID、内容摘要和 sessionStorage 待确认记录原样移植。
- **原生会话**：`openNative` 的新标签页流程原样移植，包括先开空白页、空间 JWT 校验和会话可读检查。
- **路由**：继续使用 hash，保持 `connect`、`space`、`task`、`round`、`native-expired` 的含义；新增 `view` 参数记住当前入口，刷新后不丢失。

### 构建与交付

- 一个共用的前端构建函数：`Bun.build` 打包 TSX，Tailwind 扫描页面与 UI 库源码生成 CSS，生产模式压缩。Hub、组件目录和原型都用它。
- Hub 前端产物输出到被 `.gitignore` 的 `dist/` 规则忽略的目录。`scripts/build.ts` 先构建前端再编译二进制，`page.ts` 以文本导入嵌入产物；`bun run dev` 和集成测试脚本同样先构建前端。
- `/hub` 只返回最小骨架（挂载点和无脚本提示），CSP 只按上节调整 `style-src`；`/hub/native.js` 继续按现有方式转译，本次不改。
- TypeScript 配置加入 `jsx: react-jsx`，类型检查覆盖 `src/hub/web` 与 `packages/ui`。

## 与现有功能的差异

现有前端是 MVP，布局与交互不作为约束（需求）。功能层面的差异：

| 现有 | 新界面 | 处理 |
| --- | --- | --- |
| 生成邀请后可“复制”和“下载备份” | 保留复制和可选中的文本，去掉下载备份 | 需确认：邀请 24 小时内一次性使用，应立即交给对方；下载会把 token 留在磁盘上 |
| 任何操作进行中，页面全部控件禁用 | 只禁用当前操作的控件 | 防重复提交的范围不变 |
| 身份、空间和资源 ID 直接显示在卡片上 | 收进检查器或“更多”菜单，可选中复制 | 仍可获取 |
| 任务详情以五段原始 JSON 展示配置快照、执行观察等 | 按原型分标签展示结构化信息，原始数据保留在可展开的诊断区 | 信息不减少 |
| 所有结果通过页面顶部一条通知显示 | 成功用轻提示，失败、未确认和离线用页内横幅 | 播报改用 `aria-live` 区域 |

除上表外，现有能力在原型中都有对应入口（按任务、机器、Runtime、Agent、仓库、我的选择、成员、账号与连接逐页对照原型代码和执行记录中的对照表）。

## 后端

按已验收原型核对，现有接口已能提供所需数据，目前没有必须的后端改动。实施中如果交互优化需要调整接口，在计划中单列，写明契约、调用方和验证；持久化格式变化遵守项目约定，不兼容升级先由用户取舍。

## 验证

| 对象 | 方式 |
| --- | --- |
| UI 库 | 在组件目录页上用 Playwright 检查角色与名称、键盘操作、可见焦点、Escape 关闭并恢复焦点、减少动态效果与减少透明度；浅色与深色截图使用 GPU 合成，否则圆角玻璃的模糊不会渲染 |
| Hub | 新的 Playwright 套件替换现有页面测试，基于现有集成夹具驱动真实二进制：账号注册、登录、重置与设置；连接确认；空间切换与旧响应失效；8 个入口的主要操作；创建回执恢复；刷新失败保留内容；会话过期；原生会话打开。三档尺寸，监听 CSP 违规 |
| 纯逻辑 | `bun test` 覆盖回执状态、上下文隔离和 hash 路由解析 |
| 原型 | `verify.mjs` 继续运行；用 React 重写后，与已验收版本逐入口截图对比，差异逐项核对 |
| 仓库检查 | 更新 `ci-scope.mjs`，让 `src/hub/web` 和 `packages/ui` 的改动触发类型检查与对应测试；按 AGENTS 执行 typecheck、test、build、test:tools、文档与工作流检查 |

## 切换与回退

在 Change 分支上完整替换，新界面全部完成后删除旧前端模块，不保留新旧并存或开关。不涉及数据格式，回退为撤销合入提交；会话键不变，回退前后已登录的标签页都不受影响。

交付顺序：先做 UI 库、构建链和工作台壳，再按入口实现页面，然后用 UI 库重写原型包，最后替换测试并删除旧前端；具体任务在计划中定义。

## 冗余审查

| 机制 | 结论 | 理由 |
| --- | --- | --- |
| CSP | 保留，只放开内联样式 | 注入漏洞的第二道防线，只是一个响应头；样式放开的理由见上 |
| 每次请求生成 nonce | 不做 | 只对 Radix 生效，sonner、vaul 仍会被拦，长期要逐个排查依赖 |
| 创建请求 ID、摘要与回执核对 | 保留 | 防止结果未知时重复创建，需求明确要求 |
| 身份或空间切换后丢弃迟到响应 | 保留 | 防止旧空间数据显示在新空间，Spec 已有要求 |
| 操作期间禁用全部控件 | 删除，改为只禁用当前操作 | 防重复提交只需作用于当前操作；全局禁用会挡住无关操作 |
| 数据缓存库（如 TanStack Query） | 不引入 | 需求只要求保留上次结果和上下文隔离，一个小 hook 足够 |
| Storybook 或文档站框架 | 不引入 | 一个组件目录页同时满足浏览和测试 |
| 图标库 | 不引入 | 已验收视觉使用自有图标，混用两套会破坏笔画统一 |
| 提交到仓库的截图基线 | 不做 | 验收时现场生成对比即可，长期维护基线成本高于收益 |
| 带内容哈希的资源名与长期缓存 | 延后 | 现在 `/hub` 统一 `no-store`，预计资源 gzip 后约 150KB，暂无性能问题 |
| UI 库独立版本号或 npm 发布 | 不做 | 只在仓库内使用 |

## 待确认

- CSP 放开内联样式（削弱现有保护）。
- 去掉邀请的“下载备份”。
