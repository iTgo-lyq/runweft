# 发布提速验收

Agent 自动本地验收通过。依据本分支 AGENTS.md 的既有工程决策、自动本地验收与验收后同步 Specs/归档授权，以及用户本次“建立独立 worktree 继续推进 codex/release-throughput”的明确要求；不记录为用户已手工验收。

## 验收对应

| 要求 | 实现与证据 |
| --- | --- |
| 完整门禁后晋级 | workflow 与脚本双重检查 beta、三组公共集成和四平台安装结果；稳定/预发行五模式以及失败、取消、跳过夹具通过 |
| 不可变候选 | descriptor、五包 metadata/SHA-512 与两程序 SHA-256 校验；实际公共 1.1.4 下载、解包和配对摘要通过 |
| 恢复不重建/重传 | 原 run/attempt 的 descriptor、上传及上传前检查证据要求；预发行重跑全部 job/main+source-run-id、部分上传和未知结果拒绝均有测试 |
| 读取有界恢复 | HTTP 404、429、流中断可恢复；总预算、Retry-After、鉴权、410、非法地址、manifest/hash 和响应清理错误边界通过 |
| 官网自动接续与当前 main 保护 | 绑定实际 run ID、来源及版本；超时/未知/失败不盲目重发，未晋级等待和旧 main 拒绝夹具通过 |
| 官网完整验证 | CLI 夹具核对唯一 URL 通过而正式域名失败的门禁；既有 1.1.4 两地址十文件及桌面/手机三页只读实测通过，失败与定向续验保留原记录 |
| 自动汇总 | 实际读取历史发布 2 attempts 与官网日志；47 条证据、13 个 job，4 个继承成功 job 不重复计时；失败官网 run 和缺失日志 fixture 通过 |

## 已执行检查

- `bun run typecheck`，260 项根测试，固定 HAPI 的 `build:hapi`。
- `node --test scripts/tests/*.test.mjs website/publish.test.mjs` 最终 59 项通过。
- actionlint 1.7.12 校验三份改动 workflow；workflow 状态检查及 `git diff --check`。
- 公共 1.1.4 候选的 access 4 脚本、storage 11 脚本、web 3 脚本，独立现场均通过。
- 实际页面 DOM 精确 npm 安装、两程序 hash、README 和五份 Skill 内容核对通过。
- 既有生产部署十文件/两地址及三页两宽度浏览器证据，详见 Execution 中的失败诊断与定向续验。
- Plan 用 iclaude 评审；最终由隔离上下文 subagent 独立评审完整差异，两项发现均修复并复核，另独立运行 9 项定向测试。

证据均保存在该 worktree 的 `.dev-smoke/`，未提交原始现场、凭据或模型记录。各次失败保留原证据，不改写为成功。

## 未验证范围

未公开新版本、未重新上传 1.1.4、未触发真实自动 dispatch/新生产部署，也未运行修改后完整四平台 CI。1.1.4 原四平台真实记录仅证明原候选，不能代替新工作流运行。新流水线耗时与 runner 使用量留待下一次授权发行；约 4–5 分钟节省是设计估算。未新增模型验收、Mac/arm64 模型或物理跨机验证。以上均为 Requirement 已约定边界，不以额外发版制造性能样本。
