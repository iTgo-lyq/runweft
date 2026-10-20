# T1：发布输入完整性

候选校验共用的 packageInputs 现在包含 UI 构建器、组件与样式源码、根 TypeScript 配置和根 `.gitignore`；版本准备为 1.2.1。新增临时 Git 回归覆盖这些输入的工作区、暂存和已提交变化，以及新增未跟踪组件；独立原型说明变化仍允许复用。

本地验证：

- `bun run test:tools`：61 项通过；补入 `.gitignore` 后定向重跑新增回归通过。
- `bun run typecheck`、`bun run build`：通过；使用相同 HAPI pin 与已核验的构建缓存。
- `bun run test`：33 项通过。
- `bun run test:integration --bin dist/runweft -- ./test/integration/release-inputs.test.ts`：1 项通过。
- `node scripts/check-docs.mjs`：429 文件、1184 链接、0 错误；已准备 HAPI 源码。
- `node scripts/check-workflow.mjs`、`node scripts/check-runweft-kit.mjs`、`git diff --check`：通过。

独立 Agent 复核发现 Tailwind 读取根 `.gitignore`，已将它纳入清单和真实 Git 测试。发布准备的验证不等于正式发行成功；原生模型验收、公开 npm 和官网的发布门禁继续按发行操作执行，结果以外置报告及 Actions 为准。
