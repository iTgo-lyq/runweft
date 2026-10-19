# 转发授权执行证据

## T1 修复转发授权并交付测试与全局本地安装

用户报告的运行版本为 1.1.8。调查发现旧页面要求请求 origin 等于页面 origin；当前账号版本虽移除了页面比较，确认服务仍把浏览器 Origin 与 CLI 登记地址比较。隔离当前源码实验得到转发 Origin 返回 401、原 CLI Origin 确认成功。

实现将浏览器 Origin 校验集中到 HTTP 入口，比较本次请求的 Host，拒绝异常或不匹配的 Origin；连接领域仍检查本 Hub 请求、browser 凭据、空间成员关系和原客户端秘密，不改变连接记录、数据库格式、激活或恢复协议。

新增 TCP 转发 fixture，保留真实浏览器的 Host/Origin。新增授权用例先在修复前运行并复现确认失败，再在修复后覆盖注册、登录、已登录标签、端口变化保留原请求、重复确认及错误来源/请求/空间拒绝。任务链接测试分别覆盖直连和 TCP 转发，保留空间、任务和轮次定位并核对原生页面的凭据隔离。

初次类型检查因新 worktree 尚未安装 HAPI 依赖而中断，补齐依赖后通过；HAPI 依赖随后以固定 Bun 1.4.2 再次检查且无变化。定向用例曾因测试注册路径遗漏 `/api/runweft/hub` 而返回无效凭据，修正测试路径并定向复验，不调整产品授权行为。

现有验证：

- `bun run typecheck`、`bun run build` 通过，沿用相同 pin 和摘要校验过的 HAPI 构建。
- `bun run test`：22 项、159 个断言通过。
- `bun run test:tools`：53 项通过。
- `node scripts/check-workflow.mjs`、`node scripts/check-docs.mjs`、`git diff --check` 通过。
- `node scripts/check-runweft-kit.mjs` 与 skill-creator 的 `quick_validate.py` 通过。
- 独立 Agent 静态场景验收覆盖已有转发、转发端口变化、任务深链接、Host 改写及旧数据/缺少工具四类条件，未发现阻塞性指引缺口。该结果不代表模型或真实 Codex 转发实测。

源码版本使用 `1.2.0-beta.4` 区分本地候选，不创建 tag、不发布 npm、不更新公开 Skill。当前全局程序与运行中 Hub 均为 1.1.8；已安装全局 Skill 的六个文件与修改前源码一致，没有发现自定义改动。全局更新与安装验证在候选打包后继续进行，旧数据和其他原生工具配置保留。
