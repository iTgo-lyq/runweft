# `.dev-smoke` 调查与一次性清理记录

## 调查基线与证据级别

调查与清理日期为 2026-10-14，仓库基线 `d298782df18abfcc58ff4aa2c426320d5ab2d950`。结论来自本地脚本、文件元数据、Git 状态与消费者核对；没有把搜索命中次数当作运行依赖数量。

iclaude 使用已配置的自定义 API 完成只读独立评审，返回模型 `claude-opus-5-5`，进程退出 0、`is_error=false`、77 turns、0 permission denials，耗时 651238 ms。此处仅保存复核后的结论，不保存凭据、配置内容或完整评审会话。独立评审针对现状与方案，不是后续实现的验收。

主 Agent 采纳了成功回收、独立目录准备、公开 Kit 独立发布和官网恢复边界等建议，同时保留评审最初未充分区分的唯一草稿、未迁移检查及来源未知元数据。另纠正 `RUNWEFT_SMOKE_ROOT` 的直接读取方数量为四个：install、service、hub-configuration、hub-resources；该变量尚不是所有入口共用的契约。

## 已执行的安全清理

用户明确要求“先把明确删了没影响的东西清理掉”，随后整理方案。2026-10-14 08:20:58 UTC 已按核实清单删除 35 个顶层项，其中 17 个目录、18 个日志文件，涉及 4840 个普通文件和 24 个符号链接。删除使用逐项允许清单，符号链接只删除链接本身，未遍历其外部目标。

清理前占用 934125568 bytes，清理后 20480 bytes，释放 934105088 bytes，约 890.83 MiB。该数字是文件系统分配量，不是新实现的性能指标。AGENTS 中“临时文件放 `.dev-smoke/`，不提交”的提示已删除，原搜索排除规则保留。

执行前再次核实：没有 Git 跟踪文件；顶层清单仍为原 38 项；待删文件自清单生成后无修改；可见进程 cwd/exe/打开文件没有指向该目录，当前用户进程均可检查。少数其他用户进程的 fd 受权限限制，未将此观察描述为系统级占用证明。本次删除操作未读取三项保留内容，清理前后 inode、类型、大小和修改时间一致。

### 删除依据

| 分组 | 依据 |
| --- | --- |
| 历史安装与服务现场 | 1.1.7 安装成功，配套服务七项成功、无停机错误；CLI 已卸载，未作为 KEEP_INSTALL 保留安装。约 829 MiB 来自服务副本和 npm 缓存 |
| 合码检查快照 | 无提交、无 stash；705 个普通文件与索引一致，内容对应 merge-report 指定树 `0638d13ce32c249ab7190714ad78d843e2c8c35b`；三份仅由对象库保留的文档 blob 是生成的冲突标记，并非手工修改 |
| Kit 分发 checkout | 工作区干净、无 stash；本地 HEAD、origin/main 与实时远端查询均为 `199d53004b8446463f03715e7f7460a5177ae12f`，无本地独有交付 |
| 旧版发布副本 | 1.1.5 汇总和一次性分析脚本；当前正式发布恢复读取 Actions 日志，不消费这些本地副本 |
| Kit 安装副本、缓存及成功网页证据 | 均为已完成的隔离验收产物；需要迁移的是临时脚本的检查能力，不是安装输出 |
| 已知失败网页现场 | 导航检查误判公开 Kit 链接；修复及定向复验已记录在 [Kit 重命名执行记录](../../archive/2026-10-14-runweft-kit-rename/execution.md)，不是未诊断现场 |
| 历史日志与空 tests 目录 | 无现行入口按这些历史日志文件名消费；测试应自行创建 fixture |

本次删除的相对路径如下，均位于 `.dev-smoke/` 下；这不是可重复执行的通配清理规则。

```text
branch-conflict-review-1ffwu_w5/
hub-console-jaumFL/
install-cfpfLt/
npm-release/
release-1.1.5/
release-audit/
runweft-kit-candidate-install/
runweft-kit-distribution/
runweft-kit-dom-install/
runweft-kit-public-claude-code/
runweft-kit-public-codex/
runweft-kit-uninstall/
runweft-skill-install/
tests/
website-Dh1IOp/
website-ZaXKGQ/
website-oY1Usk/
main-ci-38344006472.log
main-ci-full-38344006472.log
release-prep-console-baseline.log
runweft-kit-browser.log
runweft-kit-bun-test.log
runweft-kit-close.log
runweft-kit-docs.log
runweft-kit-first-sync.log
runweft-kit-install-smoke.log
runweft-kit-main-checks-watch.log
runweft-kit-main-website-watch.log
runweft-kit-node-test.log
runweft-kit-package.log
runweft-kit-repeat-sync.log
runweft-kit-uninstall-smoke.log
runweft-main-checks-watch.log
runweft-main-website-watch.log
runweft-skill-sync-main.log
```

### 保留项与后续去向

| 相对路径 | 保留原因 | 处理条件 |
| --- | --- | --- |
| `.dev-smoke/verify-kit-install.py` | 两宿主安装和旧名缺失检查尚未完整进入正式入口 | 必要检查迁入现有验收并通过后删除；不迁入公开 main 与任意源码 HEAD 的字节相等门禁 |
| `.dev-smoke/skills-sh-index-cleanup/issue.md` | 唯一索引纠错草稿，未确认已提交 | 保留；后续关联正式事项后再迁移，不自动发送 |
| `.dev-smoke/runweft-kit-deploy-key.json` | 72 bytes，来源及可重建性未知，未读取内容 | 保留；确认用途及安全保管位置后单独处理，不迁入源码 |

原生、reconstruction、collaboration、worktree-mcp、remote-mcp、website-pages 和 release-source 等恢复现场在清理时不存在；如果未来出现，不能依据本次历史清理授权直接删除。

## 仍可能调用的正式依赖

| 入口/材料 | 已确认事实 | 处理判断 |
| --- | --- | --- |
| [npm 发布测试](../../../../scripts/tests/npm-release.test.mjs) | 四处直接在 `.dev-smoke` 下 mkdtemp，未创建父目录；先前隔离 cwd 定向复现 ENOENT，创建空父目录后同一用例通过 | 消除测试顺序依赖 |
| [完整卸载验收](../../../../scripts/smoke-uninstall.mjs) | 只准备输出父目录，自定义输出可使工作根缺失；finally 在停机无错误时删除现场，不要求断言成功 | 分别准备目录，并修正失败留存 |
| [安装验收](../../../../scripts/smoke-install.mjs)、[服务验收](../../../../scripts/smoke-service.mjs)、[包验收](../../../../scripts/verify-packages.mjs) | 现有成功路径保留安装/cache/服务或解包现场；KEEP_INSTALL 返回程序路径有后续消费者 | 按本次所有权回收，保留配套程序及嵌套证据边界 |
| [官网验收](../../../../website/verify.mjs) | 正式 DOM 路径已有 Codex 公开安装，尚无独立 Claude Code 覆盖；包内容硬编码六文件，包校验另硬编码五文件 | 扩展现有入口，统一完整文件检查；不另建脚本 |
| [Kit 结构校验](../../../../scripts/check-runweft-kit.mjs) | 已枚举普通文件并检查元数据、引用及路径边界 | 复用现有能力；遵守 [Kit 独立发布契约](../../specs/release/spec.md) |
| [证据收集](../../../../scripts/report-evidence.mjs) | 默认递归根目录，复用本地根会读到旧证据；原现场可找到七份历史报告，含旧失败 | 改为显式输入；当前 CI 使用新工作区，没有证据表明真实 CI 已发生历史串台 |
| [官网恢复](../../../../website/recover.mjs) | 从 Actions 日志按精确 `.dev-smoke/website-pages/{check,deployment,prepare}.json` 选择记录 | 保留日志路径标识和跨步骤文件消费 |
| HAPI submodule 测试 | 十个测试实际向父仓 `.dev-smoke` 写入；另有 path 哈希测试仅使用字面量 | 实际写入在独立 fork 后续整理；哈希向量保留 |
| 归档、发布恢复与原生续验记录 | 历史描述不是运行依赖；原生消费者、候选指纹和恢复记录则有正式用途 | 归档不批量替换；正式恢复边界保持 |

## 本轮验证范围

本轮完成逐项删除前复核、删除结果与保留项元数据核对；清理不修改正式脚本。`node scripts/check-docs.mjs` 通过（343 个文档、872 个本地链接、零错误），`node scripts/check-workflow.mjs` 通过（55 个 Change），`git diff --check` 通过。提交 hook 是否成功以实际提交结果为准，不把前期诊断当成实现已通过。未进行新的真实模型验收、发布、部署或完整根测试。
