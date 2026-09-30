# Hub 1.1.0 完整版本验收

> 状态：同候选功能自动验收全部通过；完整交付装配待T5。
> 执行：2026-10-01，TraeX `01a0f3d9-1ed7-7b33-a2f6-146c5e371e55`，GPT-6-Astra / xhigh。用户已授权本地自动验收、逐任务提交与归档。

## 唯一候选

程序源码 `657550f20d44d1a65a48b232ef13f3ca5160e8cd`，`index.source.dirty=false`；版本1.1.0，Bun1.4.2，固定HAPI `3ac8b08b2aead13e9eaae459de62d9a5d5df7395` / 0.30.7 / protocol1。四平台均实际编译，不用旧1.0.0包重命名。HAPI源码未修改。

Linux x64 的真实registry安装位于 `.dev-smoke/install-0iuvhf/prefix/lib/node_modules/runweft/node_modules/runweft-linux-x64/bin/runweft`，后续原生/浏览器/升级/服务统一传该平台程序，未以默认dist或npm launcher替代：

- Runweft SHA-256：`45294f01f79f76bee545d1aba9a91051db97f51293e12bb68758f46d0195307f`
- 相邻HAPI SHA-256：`bdf706d7966ae4818b09029991a2bb03e70b10b0555763fc41430afd977b4fec`

`dist/packages/index.json` 和 `SHA256SUMS` 绑定五包、独立Skill及四平台程序。候选冻结后只修改验收脚本/项目文档，固定包输入经 `assertFrozenCandidate` 核对；若产品输入变化必须重建。源码交付仍取上述revision，验收提交另列，不伪称同一提交。

## 需求对应

| 父需求 | 可观察结果与证据 |
| --- | --- |
| 无注册独立身份、同token用于Web/CLI/MCP | 已安装连接Playwright五组主动创建、选择空间、RSA/WebCrypto交接；原生MCP矩阵另核对真实宿主使用 |
| 刷新/401不新建，保存导入可恢复、不认领旧资源 | 后台多身份导入/刷新/过期，服务显式reset后旧身份401、新身份/机器不同；根身份测试覆盖轮换/所有权 |
| 私有Agent与个人选择隔离，直接接口同样拒绝 | 后台十二组及hub-agent/hub-consumers根测试，成员/管理员API拒绝，CLI/MCP使用相同中心授权 |
| 管理员仅概要治理，空间外不可使用 | 后台私有Agent卡片不含内容/模型/绑定、仅禁用；根resources/agents/access覆盖跨空间ID和分享撤回 |
| 私有列表、计数、流不泄露 | 已安装后台任务筛选/分页/计数、多标签原生SSE；根HTTP/Socket/SSE当前主体校验 |
| 分享只授予使用，不扩大编辑或机器终端 | 后台共享成员执行解析、历史/编辑拒绝；原生共享机器terminal直接拒绝；消费者真实跨所有者远端任务及私有附件/代码取回通过 |
| 缺Hub/失效身份/成员/分享撤销不得绕过 | 安装与QEMU缺Hub诊断，根delegation/consumers授权及撤回停止、unknown不重发；服务机器撤销/轮换实测 |
| 多clone/worktree、fork/空间隔离、个人选择独立 | 根hub-repositories真实Git多checkout/remote歧义/漂移，后台两身份个人选择互不覆盖 |
| 无项目YAML权威，不猜测仓库/Agent | 根CLI/MCP中心解析，消费者无Runweft Agent YAML创建真实任务；旧入口删除与显式reset测试 |
| 全局/仓库Agent来源/绑定/版本可见，离线保留 | 后台完整编辑/版本冲突/历史/治理与本人选择；根资源离线库存/不可用原因 |
| Agent/Skill安装维护与安全首次任务 | 相同Skill逐文件复用阶段六独立Agent场景；本候选专用npm/MCP安装、Web交接和原生首任务重新验证，不把提示词场景当实测 |
| HAPI会话/审批/文件/terminal/SSE/Socket/Runner受限 | 后台真实HAPI消息/审批/文件和header-SSE，多标签JWT；原生RPC/任务历史为明确夹具，根access/sockets覆盖撤回/派生/拒绝；真实模型矩阵另列 |
| 只做有界reset、保留Git/worktree/模型配置 | 已安装轻量Node服务与Hub服务五组，运行中拒绝、停服保留文件、重新接入；root reset测试覆盖未知进程/符号链接/边界 |
| 同源码四平台及完整Linux x64协作 | 四平台包内容/格式/hash、registry、QEMU、Playwright与同安装程序；消费者十组、原生十二组全部通过 |
| 完整源码/包/Skill/官网/可读证据本地交付 | 平台/Skill/官网已生成；完整装配待T5；Mac/物理远端边界如下，不发布或更新在线服务 |

## 当前验证结果

全部原始现场在 `.dev-smoke/`，不提交凭据、完整原生输出或浏览器存储。已完成JSON均 `success=true`，具有清理字段者 `cleanupErrors=[]`。

| 验证 | 结果与现场 |
| --- | --- |
| 基础检查 | typecheck/build通过；根 `./test` 256 pass / 0 fail / 5244断言 / 41文件，53.80秒；`reviews/hub-final-release/t4-{typecheck,tests,build}.log` |
| 四平台包 | `release-packages-4r0sFh/evidence.json`：五包/Skill、README、HAPI pin/许可/对应源码、Mach-O/ELF架构/hash；Linux x64直接包运行相邻HAPI和默认服务，无Bun/模型PATH |
| registry安装/MCP | `install-0iuvhf/evidence.json`：安装、重装、卸载留存、缺平台包诊断、两宿主MCP配置保留；内部 `services/service-dtpVJt/evidence.json` 五组默认服务/信号/重启/reset |
| Web交接 | `hub-connect-6YYKmD/evidence.json` 五组；密文持久、原子本地保存/并发complete、取消/重试、跨origin和秘密扫描 |
| 后台 | `hub-console-29ckel/evidence.json` 十二组；完整资源、成员/选择、任务分页及HAPI受限页面；桌面与390px截图实际检查 |
| 服务/机器凭据 | `hub-service-19Qkoq/evidence.json` 五组；显式接入、撤销后拒绝、原机器轮换重连、监督Runner重启及reset保留 |
| 真正升级 | `hub-upgrade-cRBbpw/evidence.json`：阶段六Hub/schema18程序1.0.0→本候选1.1.0，诊断运行/安装版本差异，停服升级后身份、机器、Agent/仓库、附件/worktree字节不变；不是旧root兼容或回退 |
| Linux arm64 | `arm64-ZbA6kB/evidence.json`：QEMU7.2.22执行两程序版本、init/config/paths、agent list明确缺Hub、预览/apply reset及再次init；9条当前命令，不使用旧agent init |
| 官网 | `website-axoqia/evidence.json` 十一组；真实下载Skill/四平台/子路径hash、320–1440px/键盘/无JS、坏hash阻止安装、Linux x64从DOM命令真实安装；桌面截图实际检查 |
| 原生十二组 | `hub-native-mcp-pmeb7u/evidence.json`：两原生宿主×两runtime×shared/本机worktree/同机远端全部通过，真实spawn/wait/read、父身份、工作区/目标、报告、递归拒绝、轮末PID退出；四次长等待65010/65039/65195/65176ms，最终无非预期审批请求 |
| 真实消费者 | `hub-consumers-J9qXud/evidence.json` 十组：独立登记、远端prepare/replay/release，共享两轮、确切missing新session重建、本地worktree、跨所有者远端Claude输入/附件/bundle取回及显式清理，两runtime精确停止/旧轮次拒绝/原session记忆续接，Hub重启读取原报告与ID、不重跑 |

产品Skill自阶段六归档 `9f85353` 后内容完全相同，`git diff`与最终包逐文件检查一致；因此独立Agent判断场景复用 `.dev-smoke/skill-scenario-final.md` 和 `.dev-smoke/runweft-install-cycle-KC3taFHW/evidence.json`，不把其旧程序安装当成新候选运行证据。

## 失败与边界

T1/T2预演修正旧安装措辞/版本探测home、模型额外Git命令的审批harness；四次远端预演整组失败均已清理，后改为非预期命令原生拒绝、准确预期才批准，最终聚焦通过。失败现场为 `.dev-smoke/hub-native-mcp-{Hhc9Ki,ncc2IL,MQcEkf,LNlROL}`，不算作整组通过。完整记录在本Change的execution.md；未修改HAPI/默认权限或放宽unknown保护。1.1.0统一运行结果只采用本页所列本批证据。

- macOS arm64/x64实际构建、格式/内容校验；未在Mac实机运行，未签名/公证，按用户既定约定另验。
- Linux arm64只有QEMU用户态CLI验证，无原生arm64完整服务/模型证据；不注册全局binfmt。
- 同机独立Runner是真实执行和传输链路，不等于物理跨机/真实网络验收；外部机器访问条件尚缺，按授权保留边界。
- 后台任务历史、部分session RPC和terminal/fork协议测试是明确夹具，不伪称真实OS PTY或模型。模型执行由独立原生MCP/消费者证明。
- 未触发远端GitHub CI、未运行生产Nginx/TLS部署、未执行HAPI全套测试；不把本仓库根测试通过外推为上游全部通过。
- 无push、公开npm发布或在线Hub/Merlin更新；用户Codex/Claude全局配置和模型原件未修改。原生验收副本实际Codex模型为gpt-6.1-sol/xhigh，不是产品默认或主执行模型。
