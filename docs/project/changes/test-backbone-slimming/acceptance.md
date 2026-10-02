# 第二轮测试瘦身验收

2026-10-03，按用户授权完成本地自动验收。产品源码、对外接口、权限边界和HAPI源码/pin未变；没有添加数据迁移、兼容读取或旧数据清理。分支 `codex/test-backbone-slimming`，基线 `6cb4332`；没有推送、发布或修改用户原生配置。

## 收敛结果

| 范围 | 基线 → 当前 | 判断 |
| --- | --- | --- |
| npm测试命令 | 47 → 7 | 核心、四组集成、六主链/专项/扩展共用入口，删除旧转发命令 |
| smoke入口文件 | 48 → 32 | 删除重复模型生产者、消费者和包装层；保留有独立故障的集成 |
| 根测试 | 255 → 248，42 → 41文件 | 删/合并3个浅层测试；新增4个真实fixture/超时/证据出口回归；8个发布用例迁到Node，不能算删除收益 |
| Node测试 | 发布17、CI选择2、网站14，共33通过 | 包含已完成Beta分支的9个新增发布用例；每种引擎只在对应gate执行一次 |
| tests/scripts/CI/package.json | 净减少约2,200行 | 包含本轮新增可靠性检查、CI选择及Beta保护；不是产品代码删减比例 |

逐项删留与保障接替见 [Research](research.md#t2-实际删除与保留映射)。没有为减少数量删掉权限、CAS、未知恢复、真实超时、72MiB流式文件或必要故障恢复测试，也没有新增测试框架。

## 保障覆盖

| 模块/边界 | 保留的核心位置 | 本轮执行 |
| --- | --- | --- |
| 配置、存储、格式拒绝 | config/state/agent/runtime根测试 | 当前格式重开、WAL、不支持格式无写拒绝；版本拒绝临时破坏时保留测试实际失败 |
| 身份、空间、资源、仓库、Agent | hub身份/资源/仓库/Agent/CLI根测试，access组 | 真实HAPI HTTP/Socket/SSE、私有/分享/撤权、Runner重查 |
| 委派与持久协调 | tasks、task-rounds、task-workspaces、hub-delegation根测试 | 幂等、并发、取消、恢复、unknown及执行与交付分离 |
| MCP接入 | mcp、tasks-mcp、artifact-mcp、hub-consumers | 17工具契约、四host/runtime无模型组合、父隔离、stdio/取消；六链真实MCP接线 |
| 工作区和Git | task-workspaces、remote-tasks、storage组，N3/N4及消费者 | 固定base、hook重试、无改动无新提交、停止/删除互斥、refs与报告留存 |
| 附件和远端成果 | artifacts/task-files/task-outputs/remote/task-results，storage组，N4–N6 | 路径/字节、pin、流式传输、模块/LFS、离线取回/丢回执、显式释放与合入 |
| 查询和浏览器 | tasks-overview/hub-console/proxy，web组与两种原生历史消费者 | 授权/CSP/MIME、身份失效、XSS、分页、迟到响应、CAS保留编辑、真实归档消息 |
| CLI/安装/发行 | cli/service-commands/mcp-install/release根测试，service-package组 | 真实接线/退出/信号、原生配置不覆盖、冻结候选/hash/四平台包、专用安装卸载 |
| 原生控制和恢复 | 双runtime控制及missing重建专项 | 实际允许/拒绝、steer/不支持、精确interrupt、一次新输入和原记忆恢复；unknown不当missing |
| fixture/清理 | acceptance-fixtures、smoke-lifecycle，逐case消费者 | 构造失败、坏hash/浏览器、跨轮输入、超时exit0仍失败、三个真实消费者错误出口、所属PID/目录清理 |

## 实际验证与候选

干净候选来自 `6a7e559fc878989c91280213e6cdd54c27fcc110`，1.1.1，source.dirty=false；HAPI `3ac8b08b2aead13e9eaae459de62d9a5d5df7395`。四平台 `package --all --reuse-hapi` 和包核验通过，Linux x64从专用registry真实安装。随后仅调整验收/CI/项目记录，固定packageInputs没有变化，未重复构建候选。

- typecheck、actionlint1.7.12、33项Node检查和稳定版官网构建通过。未修改页面，不重复官网完整浏览器验收。
- 核心247项在三个新现场串行通过，均0失败、4779断言，57.789/57.882/57.355秒，中位57.789秒；与独立原生链重叠，仅作为稳定性样本。随后新增消费者出口回归在多次零模型preflight通过，最终无其他验收占用的完整根测试248项通过、4799断言、41文件、57.652秒。
- 基线单次60.078秒。上述结果不足以宣称根测试显著提速；主要减少的是重复模型/浏览器生产流程和重复CI候选。
- access：integration-yZJOOv，4脚本通过、165.076秒；storage：integration-Bb108N，11脚本通过、247.325秒；service-package：integration-03NyeF，4脚本通过、115.163秒。web前两脚本通过，console修正后hub-console-wDqAAi的16项通过；没有重跑已通过组。
- arm64-xZ2VcN以现有专用QEMU/sysroot验证当前候选基础命令通过；不表示arm64原生服务或模型通过。

### 原生主链与专项

以下缩写均是本工作区 `.dev-smoke/` 下的证据目录；完整路径、阶段和首次失败见 [verification.json](verification.json)。MCP计数是工具调用数，不是模型请求或token。

| ID | 实际范围 | 最终证据 | MCP调用 |
| --- | --- | --- | ---: |
| N1 | local Codex→Codex shared、两轮、65秒wait、真实历史/重启 | native-backbone-ivmonJ | 8 |
| N2 | hub Claude→Claude shared、两轮、65秒wait、真实历史/重启 | collaboration-O1jQvU → shared-package-RLcBaa；分阶段修正后通过 | 17 |
| N3 | hub Codex→Claude worktree、工程继承、真实hook失败后retry_finish | native-backbone-PKT4QY | 22 |
| N4 | local Claude→Codex worktree、双轮输入输出、无变更无新提交 | native-backbone-Iw79ls | 10 |
| N5 | hub Codex→Claude remote、MCP成果与文件、离线取回/留存释放 | remote-mcp-R2VNPG → remote-package-xfUR6U；两子进程成功，外层证据解析错误已修正 | 33 |
| N6 | hub Claude→Codex remote、同类反向接线及消费者/清理 | native-backbone-oRQ53h | 14 |
| 控制 | Codex/Claude允许、拒绝、续接、精确中断；Codex steer/Claude不支持 | native-backbone-ZBHHv2 / anzRhp | CLI原生探针 |
| 重建 | 真实空原生历史确认missing，保留业务记忆且只接受一次新输入 | reconstruction-R1udSK显式续验 / native-backbone-XLLNp0 | CLI原生探针 |

六主链最终实际生产合计104次MCP调用。初次N1在生产者修改后失效并重验，初次N2失败，连同这两次共119次；专项与同一轮内模型推理不能由MCP次数推算。没有采集完整模型请求/token总量，不做金额或token节省估算。

### 首次失败、修正和成本

按最初完整gate统计：六主链4/6首次通过，四专项3/4首次通过，共7/10；不是“零失败验收”。三个逻辑case共四次意外失败出口，均定位为验收代码/指令问题，无证据表明是产品或服务商故障；另有一次显式注入N2 producer前失败，已验证N1成功case保留、没有启动N2模型，不计意外失败。

| 首次结果 | 原因 | 实際修正和重跑范围 |
| --- | --- | --- |
| N2生产失败，S5Kht4 | 探针静默成功，子执行读取helper确认，超出宿主当时白名单而停止 | 明确成功输出与任务说明，只允许精确helper/proof只读；新现场重验N2。共享生产逻辑变化使旧N1失效，最终N1重验 |
| N2消费者失败，sGVq91/ImyBKb | Hub模式错误读取中心的未连接身份路径；未启动源进程被误报停机不确定 | 使用本case实际客户端身份；消费者未启动也检查源home/PID。复用已完成生产，只重跑无模型消费者 |
| N5外层失败，NmjbW4 | remote消费者成功退出并清理，但打印前缀未被汇总器识别 | 统一唯一Evidence出口；实际运行三个消费者缺失handoff的负例前置检查。N5不重跑，N6验证正常出口 |
| R-codex失败，wsf46S | 按runtime拆分后仍断言固定2/4会话 | 精确比对实际sessionId集合；确认第二轮未接受、原生历史hash和停机后，沿既有显式入口继续第二轮，首轮不重放 |

另保留T3 console三次失败：心跳过期一次、人工EventSource与真实撤权重定向竞态两次。修复fixture持续心跳/回调异常归集，删除额外竞态请求，保留实际授权失效断言；只重跑console。CI工具安装还在本地发现Claude ignore-scripts仅留下占位入口，显式安装并检查version后通过，没有带到远端试错。

六条主链完成所用的最终入口及N2消费补验约23.01分钟（含必要前置、消费和清理）；T4阶段有计时的原生入口、失败、预期注入及两次显式补验累计约33.08分钟。后两次补验约10.924秒/21.186秒，由文件创建与证据完成时间估算；早期零模型准备失败没有完整计时，不把记录累加声称全部开发耗时。首个模型入口到最终N1结束墙钟44.33分钟，包含修正、CI/文档工作和最多两条并行验收。四个失败入口合计12.04分钟，但其中成功产物/首轮被复用，并非全部浪费；额外失效N1为3.24分钟。没有把失败次数隐藏在最终成功记录里。

前轮远端四次尝试合计72.77分钟、374次MCP调用，前三次失败55.14分钟；本轮N5/N6只覆盖两个交叉配对，不能据不同规模直接宣称同矩阵提速百分比。完整四配对仍由无模型接线测试保障，原生身份/映射/HAPI/workspace变化按Technical触发expanded。

## 清理、CI与边界

成功主链的ownedRoot均已删除；控制/重建只留精简证据，原生配置源hash逐次不变。初次失败N2的专用现场经实际status/PID核对后删除，原失败证据保留。根测试没有遗留新目录，临时CI工具prefix已删除；preflight成功后删除自有目录并经过零模型实跑。没有扫描或清理用户/旧版本数据。

普通CI核心与相关Linux集成共用一次checkout/依赖/工具；先装固定Codex避免两个真实配置测试被跳过。tag/手动候选才运行完整四平台构建、全部无模型组及平台安装；npm同run等待候选，Beta通道/回执/官网资格保护保留。仅本地静态与选择测试通过，未触发远端GitHub Actions。

本轮未执行expanded十二组合、HAPI全套测试、Mac实机安装/模型、arm64原生服务/模型、物理跨机/WAN、在线发布和官网部署。相同已验证包输入不因提交/归档重复构建或重跑模型。旧候选结果不冒充当前候选的这些缺口。
