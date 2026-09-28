# 统一 CLI 与部署执行概况

## 一次 Plan 评审

- 评审者：当前工作区 iclaude，会话 `16a8a0bc-ebe9-4146-b67e-db34767a6288`；2026-09-29 完成，退出码 0，结论“小幅修正后即可执行”。原始材料在 `.dev-smoke/reviews/unified-cli-and-deployment/`。
- 采纳：显式控制 HAPI 部署环境变量、关闭托管 Runner 版本 handoff、区分本地/Hub 服务端/Hub 客户端操作、补公开 URL 和 Web 登录入口、真实 registry 安装验证、Node 启动器信号转发、私有 HAPI 端口自动选择。
- 独立判断：不全面禁用 HAPI 域，只阻止覆盖同一托管服务；停止使用本机归属核对，无需新增远端管理权限；工作区绑定用 SQLite 唯一约束代替手写 JSON 文件锁。
- 不另开产品确认：用户已授权自主实施与验收；npm 包名/自身许可的公开发布事项留到集成发行，本 Change 只生成和测试候选包。

## T1 配置、工作区绑定与可运行 CLI

- 结果：已有独立 CLI 可生成/保留 YAML 配置、编辑并校验字段、显示生效来源与数据路径，以 SQLite 持久绑定真实目录和 Git 根；无效配置仍可查询文件位置。
- 验证：`bun run typecheck`、`bun run test`（9 项 / 41 断言）、`bun run build` 通过。编译后的程序在专用 home、PATH 不含 Bun 的情况下完成 init、幂等 init、config check、paths 和跨进程稳定 workspaceId 验证。
- 修正：初次使用 `bun test test` 被 Bun 当成名称过滤而包含 HAPI 测试，已中止并改为 `bun test ./test`；不把该误跑结果计为验证。HAPI 工作树保持干净。
- Commit：`unified-cli-and-deployment T1: add configuration and workspace CLI`
