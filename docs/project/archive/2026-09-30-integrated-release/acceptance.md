# Runweft 1.0.0 完整交付验收

> 日期：2026-09-30
> 结论：本次约定的自动验收通过。Mac 实机由用户验证，物理跨机按既有授权延期；两项均保留验证缺口，不影响对应产物和功能交付。
> 依据：用户授权逐 Change 实现、自动本地验收及归档；2026-09-30 明确允许 Playwright，并接手 Mac 实机验证。未新增人工确认门禁。

## 交付物与来源

版本为 **1.0.0**；配套 HAPI **0.30.7 / protocol 1**，固定 revision `92225a8043987190690187c82149b9ac62afcd09`。候选从干净的 Runweft 提交 `ebd69e8c424ae25aec1e33379ec01f4c87b8992a` 构建，`index.json` 中 `dirty=false`；此后的改动限于验收脚本和项目文档，产品代码、依赖、构建脚本和包内使用说明未变化。

工作区中的完整交付归档为 `dist/runweft-1.0.0-release.tar.gz`（778,574,699 字节），同目录提供 `.sha256` 文件。SHA-256：

```text
d6b1d689bb9dd516b65278f51c90016a8a03de08ec6c523d2f6700df12cd5830
```

归档内含五个版本化 tarball、五份 manifest、使用说明、来源索引和校验清单；不含验证目录、原生配置或凭据。解包后按 `runweft/README.md` 操作；仓库中的同一说明见[直接安装交付包](../../../usage.md#直接安装交付包)。

| 文件（位于 `dist/packages/tarballs/`） | SHA-256 |
| --- | --- |
| `runweft-darwin-arm64-1.0.0.tgz` | `2c8607f506ecb3f2ad752ad9d4797c6279838195ccfb6ad58afbb1f864664828` |
| `runweft-darwin-x64-1.0.0.tgz` | `9caff89740e6a536907a5d3c7d61f8023773c1a90cdd20affbef85ca989980f5` |
| `runweft-linux-arm64-1.0.0.tgz` | `07a331ec60a7210ea70628270601220fecf5fe58bd8bd86a746acdb9eadc3934` |
| `runweft-linux-x64-1.0.0.tgz` | `6cb5bda596a4066a47c144726b55b9ce60b3ba316470ff4b5fe66855b9d40553` |
| `runweft-1.0.0.tgz` | `448d93defbe257b08ff2cc5bc7c496d0eb2640661a86d654af299a94014e7b82` |

`dist/packages/SHA256SUMS` 同时校验 `index.json`；索引含各 tarball 的 SHA-512、四平台程序 SHA-256、源码 revision 和 HAPI pin。主包与平台包可用于后续发布，但没有执行 npm publish、push 或创建 PR。直接平台包安装不需要全局 Bun、Node 或另一份 HAPI；npm 方式需要 Node.js 20+ 及同时提供五个包的 registry。

Linux x64 原生矩阵使用真实 npm 安装后的程序，证据入口为 `.dev-smoke/c12-final-candidate.json`。Runweft SHA-256 为 `e681e8f801c81c31de0788b8901609d2a6b1576d4715cb6485b5348033bc4de3`，HAPI 为 `e8cd31cd6d36e56a9b99143d7e7a752f65b6f4c30b5b72d03862651236d52b17`。最终核对 `.dev-smoke/c12-final-audit.json` 绑定包、程序、完整归档和 16 份验收记录，并确认 HAPI 源码干净。

## 需求对应

序号对应 [Requirement](requirement.md#验收标准) 的顺序；详细命令和原始证据位置见 [Execution](execution.md)。

| 项 | 可观察结果与证据 |
| --- | --- |
| 1. Mac 双架构 | arm64/x64 与 Linux 同版本构建，检查 Mach-O/ELF 架构、执行位、许可、匹配源码、使用说明与 hash。Mac 实机由用户按安装说明执行，尚无最终版本实机证据。 |
| 2. 全局 MCP | 已安装候选在专用 Codex/Claude 配置上各连续两次安装、卸载，完成 stdio 握手及备份恢复；其他 MCP、注释、权限、模型与 hooks 保留，原配置逐字节一致。见 T1 安装证据。 |
| 3. local/Hub 与配置 | 解包与 npm 两种独立安装完成初始化、配置校验、路径查询、诊断、local/Hub 启停及认证；原生矩阵在两种模式执行。无需开发 checkout 或全局 Bun。 |
| 4. 持久数据 | 数据根、业务库、HAPI 数据、文件、机器连接、worktree 和缓存归属明确；中心/Runner 重启后原任务、报告、原生 ID、附件和代码结果可查询取回。备份恢复使用原绝对路径。 |
| 5. 三类资源 | 全局机器与 runtime 分别登记；全局/项目 Agent 定义解析并引用 runtime，个人绑定单独保存。安装、矩阵和升级保留记录，界面按其实际身份显示。 |
| 6. 单 CLI | 配套包包含 Runweft/HAPI；使用、安装 MCP、服务管理、登记、委派、取回和看板均经 `runweft`。原生详情沿统一地址进入 HAPI。 |
| 7. 完整组合 | 两宿主 × 两 runtime：shared 的 local/Hub 共 8 组，本地 worktree 的 local/Hub 共 8 组，远端 worktree 的 Hub 共 4 组，全部真实 MCP/模型调用通过。远端为同机独立 Hub/两个 Runner。 |
| 8. 续接与留存 | 同 session 第二轮、定向结束进程、worktree 留存均通过；精确历史缺失才重建，新 ID 与来源可追溯。执行结束、文件/代码交付、主仓库显式合入分开表达。 |
| 9. 统一成果与看板 | 8 组附件组合通过；远端组合另含两轮输入/输出、Git/LFS/递归未变子模块、MCP fetch、执行端离线后的 CLI 取回与显式 merge。Playwright 使用同一安装候选及真实任务历史进入 HAPI 会话详情。 |
| 10. 失败路径 | 丢失接受/输入不盲目重发、准备失败不启动、封存失败留现场、补交不重跑模型及高 schema 拒绝由根测试故障 fixture 验证；原生审批/拒绝/中断、精确 missing 重建和服务版本不一致另有真实实验。 |
| 11. 完整能力与配置保护 | 十一个领域 Change 均先实现验收，集成版本无占位流程；模型验收使用专用认证/配置副本，未改用户原生配置或默认权限。看板的故障/分页合成数据仅存在于测试现场。 |
| 12. 升级回退 | 保留的 0.1.0 到 1.0.0、相同 HAPI/schema v6 下兼容回退、停止后完整备份恢复通过；任务、身份、文件和 Git 状态保持，旧现场原件归还后 1292 项指纹一致。0.1.0 仅为本地实验基线，不承诺任意版本回退。 |

## 实际验证范围

- **工程与发行**：干净源码 frozen install、`bun run typecheck`、173 项根测试、四平台 build/package 通过。独立暂存打包的 exit 42 故障注入保留旧产物并清理暂存。检查包内使用说明与仓库说明相同，HAPI 原始许可/NOTICE/工具许可及匹配源码齐全。
- **原生协作**：20 组核心协作、8 组附件和 2 组 MCP 控制通过；Codex 追加输入、两 runtime 定向 interrupt 均有证据，Claude 追加返回明确 `steer_unsupported`。另验证两 runtime 的原生审批/拒绝、模型参数与历史重建；JSONL 审计证明重建的新轮次输入只有一次，原历史未改写。
- **重启与版本**：复用已结束任务验证成果，不重新调用模型；两份回收记录、真实旧版现场副本升级/回退/备份恢复均通过，清理错误为空。
- **Playwright**：Chromium headless 验证登录、凭据恢复、筛选/分页、503 与断连恢复、无结果/空列表、URL token 清理、375/1200 布局和 HAPI 历史导航；pageErrors/cleanupErrors 均为空。截图已目视检查，60 条故障与分页合成记录明确区别于真实任务。
- **Linux arm64**：QEMU 7.2.22 执行最终程序的 Runweft/HAPI 版本、初始化、配置校验、路径和 Agent 创建/列表通过。证据为 `.dev-smoke/release-arm64/case-x4hsbvk7/evidence.json`；不宣称原生 arm64 或仿真完整服务/模型验收。

原始记录仅保存在本机 `.dev-smoke/`，不随发行包分发。各记录的用途、失败实验及模型测试修正见 [T1–T3](execution.md#t1-四平台发行包与可复现安装)，复现入口见[开发说明](https://github.com/iTgo-lyq/runweft/blob/bea2509426d9307b5df786aa3bc4c27069ad613e/docs/development.md)。

## 已知限制与用户验证

| 范围 | 已知事实 |
| --- | --- |
| Mac | 最终双架构产物已构建并核验，但未在 Mac 实机运行；程序未签名、未公证。用户按[安装与验证步骤](../../../usage.md#直接安装交付包)检查服务、MCP、委派、报告及看板。 |
| 物理远端 | 远端功能完整实现，同机独立 Hub/多 Runner 真实模型和成果链路通过；物理多机、实际网络故障及跨机操作系统组合未执行。 |
| Linux arm64 | 当前最终版本只有 QEMU CLI/配置证据；早期四平台 CI 的基础安装结果不当作最终原生协作证据。 |
| 模型环境 | 当前用户原生 Codex 默认 `gpt-6.1-sol` 在该 CLI/账户被返回“不支持”，初次矩阵在任何 MCP 派生前失败。仅测试副本改用实际可用的 `gpt-6-astra` / xhigh 后通过全部矩阵，用户配置未修改；使用时应选择账户支持的模型。 |
| 上游测试 | 固定 HAPI 的一项 skills 测试在本机受祖先 `/tmp/.git` 影响失败，隔离重跑仍是 27 pass / 1 fail；没有删除该目录或为测试修改上游。不将 Runweft 173 项通过描述为 HAPI 全套通过。调查见 [Research](research.md#当前上游测试的环境限制)。 |
| CI 与代理 | 已修复 CI 的依赖安装顺序，但本次未触发 GitHub CI。Nginx 示例明确标为未实测。 |
| 对外发布 | 本地包具备发布布局，没有公开上传。HAPI 许可及对应源码随包提供；Runweft 自身开源许可证选择未在本次代定。 |

上述范围已与用户授权和最终需求逐项对应。除 Mac 用户实机验证及允许延期的物理远端验证外，本次没有转交用户执行的本地验收项。
