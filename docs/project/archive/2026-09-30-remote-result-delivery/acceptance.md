# 远端代码回收验收

> 状态：已通过本地自动验收（2026-09-30）；依据用户持续授权，无需再次人工批准。真实跨物理机器单列未实测。
> 版本：Runweft 0.1.0，HAPI 0.30.7，固定 revision `92225a8043987190690187c82149b9ac62afcd09`，协议 1。

## 需求映射

| Requirement 验收项 | 可观察证据 |
| --- | --- |
| 文本、二进制、删除、新增、无改动 | HAPI results/workspace 真 Git 测试；T1 两轮 export；T3 无模型两轮相同 HEAD 复用清单、零新上传，不产生空提交 |
| 停止证明及 Git 收尾失败保留 | WorkspaceManager 停止/归属检查；T4 真实 Codex/Claude 各两轮的 index lock、签名、hook 故障，仅 retry-finish，无模型重放 |
| 上传失败、丢回执与执行结论分离 | root results/remote 聚焦覆盖配额、部分上传、unknown、重启；T1/T2 真实 HTTP 丢响应按原 operationId 查询 |
| 验证取回、脏主库保护 | T2 SHA1/SHA256、原仓库/linked worktree、ref 冲突、祖先/摘要核对、坏包；真实 index/config/FETCH_HEAD/工作文件保护及拒绝 hook 未执行 |
| 无 remote、未 push 仍可合入 | T6 原生矩阵无 remote，bundle/LFS 回收后操作者显式 merge；产品不自动合码或发布 |
| 源分支删除、执行端丢失后恢复 | T2 移走执行端存储及原主库旧 LFS/模块对象；T3 中心重启；T5 删除目标 checkout/cache 后重新 fetch；T6 原生任务执行端停止后取回 |
| 未知/未封存/唯一对象保留 | 原生与传输 unknown 拒绝清理；T5 shared cache、多 import、外部 refs/worktree、恢复 pin 保护与部分释放恢复 |
| 两宿主 × 两 runtime 原生 MCP/CLI | T4 CLI 两种 runtime 各两轮；T6 四组原生主宿主 MCP 两轮，自动 prepare、wait/read、附件、fetch、session 续接 |
| 新旧 LFS、递归未变模块 | T1/T2 实体校验、递归模块/重名映射、模块 LFS/custom storage；T6 同时检出真实初始二进制及两个新 LFS 文件；脏模块/gitlink 变化继续明确拒绝 |
| 不改前轮候选、幂等与不重跑 | T1 两轮固定候选、T3 相同 HEAD 及模块/LFS 复用、v5→v6 原行保留；T4 capture 门控下一轮与 consumer 插入后恢复；T5/T6 原生 session 集合不变 |
| 成果/环境/字节分开释放 | T5 实际 CLI preview/apply，部分轮次释放不解除其他 pin；两任务移除后的共享缓存最终回收；tombstone 禁止新的 fetch/retry，报告和主库 ref 保留 |
| 本地、诊断、包回归 | root 158 pass / 0 fail、3513 断言；C9 103 文件实际准备/清理；T6 本地原生 shared/worktree、四平台候选构建与 Linux x64 npm 安装 |

## 原生矩阵

每组使用专用 Hub（无 Runner）及不同身份/数据根的发起、执行 Runner，均在当前 Linux x64 机器运行。Codex 0.156.1、iclaude/Claude Code 2.1.283；原生配置和认证使用专用副本，不修改全局配置。

| 主宿主 → runtime | 两轮证据 |
| --- | --- |
| Codex → Codex | `.dev-smoke/remote-mcp-I0obyD/evidence.json` |
| Codex → Claude Code | `.dev-smoke/remote-mcp-z1iWCm/evidence.json` |
| Claude Code → Codex | `.dev-smoke/remote-mcp-IIBTDU/evidence.json` |
| Claude Code → Claude Code | `.dev-smoke/remote-mcp-ehRmBx/evidence.json` |

成功记录要求 success=true、cleanupErrors=[]。各组证明原生父身份、每轮新输入和输出、准确基线/cwd、工程指令/skill/其他 MCP、Runweft MCP 工具排除、Claude 原生 Agent 保留、两轮同 session、进程停止及 worktree 保留。MCP 每轮 fetch 后再由 CLI 离线 fetch，主库保护检查通过后由专用测试操作者显式合入。

## 其他实际证据

| 证据目录（`.dev-smoke/` 下） | 内容 |
| --- | --- |
| `repository-result-export-c2xyiU` | 真实 Hub/双 Runner 封存、独立导出与中心下载，零模型 |
| `repository-result-fetch-I9yrha` | 真实丢回执、重启、执行存储离线、基线/成果 LFS 与模块恢复、显式合入 |
| `task-result-delivery-9xFdGR` | 最终无模型业务协调回归，真实 HAPI facts、清单复用、中心重启及 CLI/MCP handler 取回 |
| `remote-tasks-native-DGZxg9` | 两 runtime 各两轮 CLI 自动准备、真实原生与 Git 收尾故障修复；现场后由留存验收显式回收 |
| `result-retention-qMZipR` | 复用上述已结束任务，逐轮 pin 释放、两任务共享 cache 最终删除、执行端离线再次取回，无新增 native session |
| `workspace-preparation-xCj3QZ` | 最终 HAPI pin 下 C9 诊断回归：103 文件、共享/跨快照消费者、重启/离线与缓存保护 |
| `collaboration-ObEUnr`、`worktree-mcp-GmaTIy` | 最终版本 local Codex → Codex shared、Claude → Claude worktree 原生两轮回归；后者 checkpoint/纯报告不产生新提交，操作者 cherry-pick |
| `install-H1OwUN`、`remote-package-ZvgvPh` | npm 实装、Node-only PATH 下服务/协议/认证/重启与卸载；复用两组原生远端任务查询/下载/离线取回，无模型重放 |

四平台 HAPI 构建与私有候选包由 `bun run build:hapi --all`、`bun run package --all` 生成，安装从专用本地 npm registry 取平台依赖，不依赖源码路径运行产品。没有 push、PR 或公开发布。

## 已知验证边界

真实跨物理机器未执行，按用户授权单列；同机独立 Runner 不能代替网络、跨 OS 路径及异机原生环境的验证。此阶段新功能在 Linux x64 原生执行；macOS/Linux arm64 的基础安装历史不冒充本次新增协作实测。

最终 HAPI 全量 CLI 为 3027 pass / 11 skip / 1 fail；失败仍为环境已有 `/tmp/.git` 使 skills 测试的非 Git 假设不成立，未删该目录或掩盖失败。Hub 1414 pass / 3 skip、Web 3249 pass、Shared 323 pass、Relay 118 pass，全包 types 通过。根项目最终全量、types 和四平台构建通过，保留上述已知失败，不宣称全部测试绿色。

首次 Codex → Claude 测试因子 agent 的命令涉及未授权的 `/tmp/hapi-blobs`，主宿主正确 abort；测试指令补明文件位置和二进制读取方式后重新验证。安装脚本修正旧版 doctor 字段断言，并等待 Hub 恢复的历史心跳按既有 45 秒期限变离线，不改变产品权限或机器状态。
