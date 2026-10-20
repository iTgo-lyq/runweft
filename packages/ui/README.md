# Runweft UI

Runweft 自有的界面库：设计 token、组件、交互行为和图标。Hub 产品与原型包都从这里取用，不各自复制样式或组件。视觉规范见 [DESIGN.md](DESIGN.md)。只在本仓库内使用，不发布 npm。

| 位置 | 内容 |
| --- | --- |
| `src/styles/tokens.css` | 颜色、表面层级、两种玻璃、阴影、字体与动效 token；浅色、深色、手机纯黑 |
| `src/styles/base.css` | 基础规则、语气色、玻璃材质，以及减少透明度与减少动态效果的退回 |
| `src/styles/components.css` | 组件样式（按钮、列表、检查器、纬线、对话框、工作台壳等） |
| `src/styles/index.css` | 样式入口：Tailwind 4、上面三层，以及 shadcn 标准 token 名到 Runweft token 的映射 |
| `src/components/` | React 组件；对话框、确认框、菜单、弹出层、开关、分段与标签页基于 Radix |
| `src/icons.tsx` | 自绘图标集（`<IconSprite />` 每个文档渲染一次，`<Icon name>` 引用） |
| `src/lib/` | `cn()`、中文时间格式、任务状态词表 |
| `build.ts` | 共用构建：`Bun.build` 打包 TSX，Tailwind 扫描源码生成静态 CSS |
| `catalog/` | 组件目录页，也是自动检查的对象 |

## 使用

应用代码从 `@runweft/ui` 导入组件（根目录 `tsconfig.json` 的路径别名）。应用的样式入口导入 `packages/ui/src/styles/index.css`，再用 `@source` 声明自己的源码目录，然后调用 `buildFrontend({ entry, css })` 得到一个 JS 与一个 CSS。不要在 TSX 里导入 CSS。

页面根节点渲染一次 `<IconSprite />`、`<Toaster />`，并用 `<ConfirmProvider>` 包住需要 `useConfirm()` 的部分。

## 新增与修改组件

- 优先复用现有组件和 `components.css` 的类名约定；能用 Tailwind 工具类完成的布局直接写工具类，颜色、圆角与字体用映射后的 token（如 `bg-surface-2`、`text-ink-3`、`rounded-lg`）。
- 从 shadcn 或 shadcnuikit 取组件时，把源码复制进 `src/components/` 后按 DESIGN.md 调整；标准 token 名已映射，类名可以保留。图标换成自有图标，不引入图标库。
- 需要键盘、焦点或浮层行为时使用 Radix 原语，不自行实现。受控对话框会把焦点还给打开它的元素，菜单与弹出层为非模态。
- 玻璃、纬线等复杂视觉写在 `components.css`，并遵守 DESIGN.md 的玻璃规则：只用于浮在内容上的功能层，不叠玻璃。
- 新组件加入组件目录，并在 `verify.ts` 中补充键盘与焦点检查。

## 检查

```sh
bun run test:ui                  # 组件目录在 Hub CSP 下的键盘、焦点、外观与偏好检查
bun run test:ui -- --screenshots # 另存浅色与深色截图到 catalog/dist
```

本机 Chromium 不能启用进程沙箱时设置 `CI=true`。截图使用 SwiftShader GPU 合成：无头软件渲染不会对带圆角的元素做背景模糊，截图会比真实浏览器更不透明。
