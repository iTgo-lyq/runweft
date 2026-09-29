# 本地独立工作区验收

验收按用户授权自主完成，范围为本 Change 的本机独立 worktree、公共 Git 能力与 CLI/MCP 交付。完整项目及真实远端验收仍由后续 Changes 承担。

## 需求与证据

| 验收项 | 实现与验证 |
| --- | --- |
| 固定 Git 基线，准备后启动 | T1 真实 Git/HTTP 核对准确 commit、子目录与准备引用；错误/旧准备、丢失 checkout 均在启动前拒绝。T2/T3 编译 CLI 的准备失败没有模型会话；T4 从旧 tag 派生，主分支更新和脏文件未混入 |
| 任务隔离、原环境续接、主目录不被收尾修改 | T3 同一源仓库两个独立任务拥有不同 checkout，慢准备期间主分支移动仍使用已接受 SHA；两 runtime 重启后第三轮保留原目录/session/ignored 依赖。T2/T4 实际比较父 HEAD/index/工作区状态与结果文件 |
| 补 checkpoint、保留已有提交、无空提交 | HAPI Git 专项保留 agent commit 后补机器 checkpoint，formatter hook 的提交树可正确固定；T2/T4 模型遗留改动实际形成 checkpoint。T3/T4 纯报告轮次 resultHead 不变；shared 回归与既有验收保持有效 |
| Codex/Claude 的真实 CLI/MCP 协作 | T2 两 runtime 编译 CLI 写入/续接；T4 两宿主 × 两 runtime × local/同机 Hub 八组、18 轮全部通过。每轮读取原生结果、关闭执行并封存；不依赖附件中心 |
| Git 故障保留现场、修复不重跑模型 | Manager 的 validate/noGitOperation 拒绝未知归属、冲突、未完成 Git 操作与索引锁。真实 Git 专项覆盖 hook、签名、锁、超时、丢提交响应及手工提交修复；T2 CLI 与 T4 两种真实宿主均完成失败 hook 后的显式 retry-finish，报告/输入不变 |
| 本地成果无须 push，可由主 agent 合入 | T4 八组从源仓库实际读取 resultRef，测试操作者显式 cherry-pick 成功，原 worktree 保留。git.status、原生执行事实、stop/finish、环境 retained 各自表达，不自动合码 |
| 继承原生配置和版本化工程配置 | T2/T4 从已有配置/认证的专用副本执行，不新增信任或全局 MCP/skill 同步；工程指令/skill 的独立标记出现在报告，子端实际调用全局及项目探针。Runweft 工具在启动/续接目录中缺席；Claude 原生 Agent/Task 保留，Codex 内置递归配置未改动 |
| 每轮停止，后轮优先复用原生 session | T2/T3/T4 核对相同 native session ID、历史记忆、inactive/archived 及执行 PID 退出；父宿主能继续调用并发起后轮，服务仍在。共享 Codex root 的隔离停止沿前置执行模块验证，不用公共 PID 代表单 root 停止 |
| 保留、显式删除与删除后的历史 | T3 真实 ignored 拒绝、重启留存错误、明确 discard 后删除，base/三轮 refs 和报告仍可读，后续 send 拒绝；中心 fixture 覆盖删除/send 互斥、停止未知、丢响应、失败准备。T5 安装产物再次删除 local Codex 与 Hub Claude 的已完成环境，目录数从 1 到 0，报告/全部成果 refs 仍在 |
| LFS 与子模块完整性 | HAPI Git 专项实际读取本地 LFS 实体及递归相对 URL 子模块，核对内容与基线；嵌套脏文件、ignored 清理和新增候选 gitlink 拒绝。缺工具/对象的准备错误不启动模型，相关启动前门禁由 T1/T2 覆盖。不声称跨机器 LFS 凭据或对象传输已验证 |

对应新增能力：`local-workspace/mode`、`readiness`、`finish` 由任务准备/收尾、原生矩阵及清理证据覆盖；`git-workspace/lifecycle` 由 HAPI 机器接口、真实 Git 与持久回执覆盖。变更的 `delegation/interface`、`results`、`rounds` 由中心 SQLite/HTTP、真实 CLI/MCP 覆盖；`execution/lifecycle`、`recovery` 由准备引用穿透与实际启动/续接门禁覆盖。

实现入口：[中心工作区协调](../../../../src/tasks/workspaces.ts)、[业务轮次](../../../../src/tasks/coordinator.ts)、[持久存储](../../../../src/tasks/store.ts)、[MCP](../../../../src/mcp/tasks.ts)、[Git 管理器](../../../../hapi/cli/src/runner/workspaces/manager.ts)。每项原始验证目录、命令与必要修正见 [Execution](execution.md)，不把模型自述单独作为完成依据。

## 候选包与最终检查

- `bun run typecheck`、`bun test ./test` 通过，100 项回归；日志 `.dev-smoke/workspace-t5-{types-final,tests}.log`。T5 只增加诊断/说明及安装验证，没有改变已通过实际模型验收的执行流程，不重复模型矩阵。
- `bun run build:hapi --all`、`bun run package --all --reuse-hapi`、`bun run build` 通过。`dist/packages/index.json` 含主包与 macOS/Linux arm64/x64 四平台包，固定 HAPI `5341b084c8650b739cd2afcda761023255326150`，含匹配源码归档和许可；主包附完整使用说明。四平台为重新编译证据，本轮实际安装/执行平台为 Linux x64。
- 实际 npm 安装 `.dev-smoke/install-2j1oqH/evidence.json` success=true；附带 `.dev-smoke/install-2j1oqH/services/service-4vO0rc/evidence.json` 覆盖 local、Hub 客户端、无 Runner 的 Hub 服务端、信号退出和卸载数据留存。安装后 task/worktree 命令与十个 MCP 工具在无 Bun/source PATH 下可用，发现不创建数据。
- 安装后的真实保留环境读取/删除见 `.dev-smoke/worktree-package-vC8aSV/evidence.json` success=true、cleanupErrors 为空。原 T4 `worktree-mcp-E5Ydih` 与 `worktree-mcp-CfQmxJ` 的 checkout 已按显式清理移除，不可再次将它们当作可续接夹具。其余 T4 环境保持原留存策略，专用服务均停止。
- `paths` 提供当前连接环境根；`doctor` 在线/离线计数与删除后元数据留存通过。无法读取环境根时明确报错而非伪装为零，证据 `.dev-smoke/workspace-diagnosis-7t4xidsg/evidence.json`。说明覆盖源 Git 对象依赖、原路径备份/恢复、无自动迁移、refs/分支维护及卸载保留数据。
- HAPI 在 T3 固定后源码未再变化，沿用当次跨包 typecheck、Git 专项 16 项及 Hub/Web/Shared/Relay 的通过记录。完整 CLI 原运行仍为 2984 通过、11 跳过、1 个既存环境失败：非 Git skills 夹具受 `/tmp/.git` 影响；该用例和实现均非本 Change 修改，不删除外部目录或声称整套 CLI 测试通过。具体日志和范围保留于 Execution。

本地自主验收已具备实现、真实模型、失败修复、安装与数据留存证据。远端基线/成果传输、附件、看板和最终公开发行不属于本 Change，继续保留在完整交付目标中。
