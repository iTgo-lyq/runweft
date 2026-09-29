# 任务附件验收记录

R1–R8 的实现与证据已核对，按用户对本地自主验收的持续授权通过本 Change 验收。各阶段完整命令、环境限制和 Commit 标题见 [Execution](execution.md)。

| 需求 | 实现与验证 |
| --- | --- |
| R1 无会话文件操作 | T1 `.dev-smoke/artifact-cli-kwDCIB/evidence.json`：配套编译 CLI 的 local/同机 Hub 上传、元数据、下载和 SHA-256，无模型会话 |
| R2 启动前输入及续接 | T2 机器下载/准备门禁，T3 `.dev-smoke/task-inputs-YvyIt7/evidence.json`：两 runtime × shared/worktree × 两轮；实际读取随机标记与工程指令、重启后复用 native session、源 Git 不变。T5b `.dev-smoke/task-inputs-uLpknW/evidence.json` 复验 shared 自动回收与后续输入 |
| R3 完整性与大文件 | T1/T2/T4 的真实 SQLite/HTTP/Runner 检查错误 hash、长度、限额、未发布不可读；CLI 与输出捕获均实际传输 72 MiB，超过原 68 MiB HTTP 上限 |
| R4 故障恢复与不可变 | T1 发布丢响应后原 request ID 查回，不重发已发布字节；T3 接受意图/pin 对账；T4/T4b 固定 capture/upload 身份、传输和协调器重启，原生派生/输入计数不增加。T6 MCP 丢响应查询和取消下载测试通过 |
| R5 部分交付与补交 | T4 `.dev-smoke/outputs-machine-neErem/evidence.json`：固定候选在源目录删除、Runner 重启/离线后仍可交付或下载。T4b `.dev-smoke/task-outputs-u3MJua/evidence.json`：8 个真实轮次生成 v1/v2/v3，失败项不隐藏成功文件，旧内容不因下一轮改写而变化 |
| R6 身份与路径 | 沿 HAPI namespace 和业务 parent 校验；HAPI 捕获/输入的目录、symlink、文件变化测试，T6 两宿主 MCP 源/目标 realpath、已有祖先、目录与取消测试。CLI 显式路径沿操作者权限 |
| R7 留存与配额 | T5 `.dev-smoke/artifact-prune-iPItLX/evidence.json`：真实预览/过期删除、引用保护、丢响应查墓碑、配额和重启。T5b `.dev-smoke/task-retention-LByxN9/evidence.json`：释放自己的历史 pin、保护外部恢复 pin、明确放弃失败候选、保留报告/Git/worktree，零模型重放 |
| R8 MCP 与候选安装 | T6 `.dev-smoke/artifact-mcp-DT6NQU/evidence.json`：八组、16 轮真实 MCP，包含 shared 和两个 Hub worktree 组合，工具过滤与其他 MCP 保留。`.dev-smoke/install-j9xFCC/evidence.json`：真实 npm 安装、15 个工具及服务模式，无 Bun/源码 PATH 依赖；`.dev-smoke/artifact-package-o91pXd/evidence.json`：安装后重启读取全部轮次与文件 hash |

输入和输出为不同持久层：中心对象及 pin 是可下载字节的权威；不可变轮次清单记录内容事实；可变 retention 记录当前保留决定；Runner 下载副本/捕获候选与 worktree 各有自己的回收条件。T5b 显式释放已经消耗 T4b 夹具的留存，不能再次假定旧测试文件仍受 pin 保护。

实际代理验证使用自建 HTTP 转发与故障探针。Nginx 示例依据官方配置文档核对，本环境未安装 Nginx，未声称实测。跨机器远端准备与 Git 成果回收由后续 Change 验收；同机 Hub 和跨平台编译不能代替该证据。


T6 最终根工程 129 pass / 2608 assertions，typecheck 和配套编译通过。HAPI 四平台构建与五个候选包完整，固定 revision c4c432ab0b376d254bf21571f4aaf51cbe3251f4；本次实际运行与安装平台为 Linux x64，其余平台不据此宣称实际执行。文件组件的完整性、断线与 Runner 离线证据复用前置阶段，未改变的原生 adapter 不重复跑无关模型矩阵。候选包尚未公开发布。
