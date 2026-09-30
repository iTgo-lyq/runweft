# Hub 完整版本最终集成技术方案

> 来源：[Requirement](requirement.md)
> 状态：已确认
> 更新：2026-10-01；工程方案与本地验收按用户持续授权确认，实施前进行一次 iclaude 评审。

## 推荐方案与依据

前六阶段已归档，当前基线 `9f85353`，固定 HAPI `3ac8b08b2aead13e9eaae459de62d9a5d5df7395` / 0.30.7 / protocol 1，Bun 1.4.2。阶段六实际通过 254 项根测试、完整后台/连接/服务 Playwright 与真实两宿主 × 两 runtime。HAPI 没有新增执行缺口，本阶段不改子模块、launcher、原生协议或数据库架构。

可发现的集成缺口已经核对：`smoke-service.mjs` 和 `smoke-install.mjs` 仍假设旧 root、自动 Runner、YAML/本机绑定；`smoke-hub-consumers.ts` 虽运行编译 CLI，服务端仍由源码 gateway 启动。后者不能证明发布程序的中心协调器。修正这些入口，不机械复制旧测试，也不新建通用验收框架。

## 安装与服务验证

保留 Node 可执行的 `smoke-service.mjs` 作为轻量发行测试：解包/registry 安装后的 CLI 启动默认 Hub，不传 HAPI executable override，实际复用相邻 HAPI；不要求 Bun、源码或模型工具出现在产品 PATH。通过公开身份 API 创建专用身份并按正式文件契约保存本地连接，用真实 CLI 登记/关联机器、Runner、诊断、重复启动、重启、信号关闭和显式 reset。身份文件写入是明确安装夹具，真实 Web 加密接入由同候选 Playwright/native MCP 单独验证。

registry 验收只服务本批包，专用 npm prefix/cache/config，不公开发布。安装、重复安装、升级式重装、卸载/重装保留数据与其他原生设置；MCP 安装到专用 CODEX_HOME/CLAUDE_CONFIG_DIR。移除旧 YAML 现场续验分支，模型与历史验收使用当前 Hub 脚本。失去平台包、缺 Hub、连接无效均验证可操作错误。

另保留阶段六已验证的 Hub 1.0.0 程序副本作为升级起点，仅在专用新建数据上运行；1.1.0 先诊断旧服务版本，再停止并重启同一数据根，确认身份、空间、机器和文件未被重新登记或迁移。这是当前 schema 18 的实际升级验证，不是旧 root 数据兼容或回退承诺。

## 同候选组合

真实消费者脚本改为通过已安装 CLI start 的默认 Hub 服务和两个独立 Runner；不在 harness 内实例化中心 gateway。身份、空间、资源与 Agent 只通过公开接口/CLI建立；测试读取证据可使用已有客户端封装，不替代服务实现。

消费者保留共享两轮、确切历史缺失重建、本地 worktree、跨所有者远端 Claude 输入/附件/bundle/显式清理，补两 runtime 的运行中停止及服务重启后只读查询，验证不重放模型。缺历史只切换专用 Runner 的空原生历史目录，机器/认证保持不变；unknown 不放宽、不盲重发。审批只针对专用任务的预期操作。

原生 MCP 使用真实 Codex/Claude 主宿主，各自调用 Codex/Claude runtime，覆盖 shared、本机 worktree、同机第二 Runner 远端 worktree，共十二组合。四个 shared 组合保留 65 秒长等待，其余复用正常 wait/read；全部核对可信父身份、报告、工作区模式、子 CLI 递归拒绝和轮末进程退出。精细附件/代码/续接由消费者链路验证，不重复制造大矩阵。

同一已安装候选再运行连接与后台 Playwright，覆盖多用户/空间、私有与共享/治理、个人配置、计数、原生详情/审批/文件/SSE、终端拒绝。未知执行、请求丢失、准备门禁与失败保护由根测试中的明确协议夹具覆盖，与真实模型结果分开记录。

连接 smoke 当前也实例化源码 ResourceGateway；改为已安装 CLI 托管服务，密文持久断言仅只读该专用 state.sqlite，不由 harness 替代身份 API。后台已有默认 CLI 服务接线，继续复用。

## 发行身份与冻结

本批版本定为 1.1.0，区分本机旧 1.0.0 认证产物；尚未公开发布，不构建旧数据迁移兼容。所有包、文档和 Skill 同版；索引继续使用 `product: hub-console-v1` 和源码 revision/dirty。源码及包内容改动提交后，从干净提交统一构建四平台，冻结 `index.json`、全部程序/tarball/Skill hash。后续仅测试脚本或非包内项目验收文档变化不重建候选；若产品源码/包内说明/Skill 改变，废弃候选并重新构建/执行受影响验证。

`test:packages` 校验五包、Skill、README、HAPI pin/许可/匹配源码、格式/架构与全部 hash；Linux x64 直接平台包和 registry 安装都真实运行。Linux arm64 使用现有 `.dev-smoke/release-arm64` 内 qemu-user/sysroot 执行版本、配置、路径和明确 Hub 前置诊断，不注册全局 binfmt。Mac arm64/x64 实际交叉构建/格式校验，但不宣称实机。

正式验收要求 `source.dirty=false`，使用安装后平台 `bin/runweft` 而非 npm launcher 作为原生/浏览器脚本入参；每份证据记录 realpath 后 Runweft 和相邻 HAPI 的 SHA-256。候选与 HEAD 的差异按固定包输入检查：`src/`、`skills/`、`docs/usage.md`、`package.json`、`bun.lock`、`hapi`、`scripts/{package,build,build-hapi,platforms}.ts`、`scripts/npm-launcher.cjs`，命中即重建；不能豁免整个 scripts 目录。源码归档取 index.source.revision，后续验收提交另外列出。阶段六独立 Agent Skill 验证仅在最终 Skill 内容逐文件相同时复用，安装/MCP和真实首任务仍用最终程序重跑。

官网从本批索引构建、下载与校验，坏 hash 不安装；不更新运行中的站点。CI 同步包含 Skill 和必要包元数据，执行当前安装入口，实际远程 workflow 未触发则保留未验证范围。最终本地完整交付包括四平台/主包/Skill、校验索引、静态网站、对应源码（含固定 HAPI 源码）及不含 secrets 的验收说明；可读证据与程序 hash 关联，临时模型/浏览器现场不入交付。

## 安全与外部条件

主执行模型固定 GPT-6-Astra，记录 TraeX 会话；iclaude 仅评审，不委派实现，额度耗尽才使用新 subagent 代评。模型认证沿已授权副本，所有可写数据在 `.dev-smoke/`。不改用户原生配置、在线 Hub/Merlin，不 push/发布。执行权限沿原生默认，不新增 OS 沙箱；测试进程隔离不是产品安全承诺。

Mac 实机由用户按既定约定验证；物理远端机器/访问条件尚不具备，这两项不阻塞本地交付但必须明示。没有其他待用户决策的必要契约。失败保留原证据与进程/服务清理结果，查明原因再重跑；不能通过修改 Spec 或降低 unknown 规则掩盖失败。
