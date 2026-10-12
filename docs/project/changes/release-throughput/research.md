# 发布耗时与实现调查

## 已验证的基线

基线为 main `1d06750e0a529afcdc3923b3e124d496f8d1396e`。1.1.4 成功发布 run `38241538144`，实际 beta job `114785075269`，promotion job `114795875870`。GitHub job 时间与已归档的 verification.json、`.dev-smoke/npm-uninstall-release/ci-evidence.json` 对应。

| 环节 | 本次实测 |
| --- | --- |
| 释放 runner 磁盘 | 100 秒；14 GB 增至 31 GB |
| 类型与根测试 | 79 秒 |
| 四平台构建打包 | 67 秒 |
| 全部集成 | 490 秒 |
| 其中 access / storage / web / service-package | 153 / 205.5 / 29.4 / 99.1 秒 |
| beta 上传与公开确认 | 605 秒；四平台上传后，主包上传前有约 7.5 分钟传播等待 |
| 四平台安装与完整卸载 | Linux x64 76 秒、Mac arm64 58 秒、Mac x64 198 秒；Linux arm64 重试后 69 秒 |
| latest 晋级 job | 53 秒 |
| 成功流水线 | 11:15:58–11:47:13 UTC，31 分 15 秒；去掉 ARM 失败恢复约 28 分钟 |

上述步骤并非覆盖全部环境准备时间，不能只把表内独立条目相加当作总耗时。发布前的门禁扩充和修复、发布后的人工整理也不属于正常 CI 时长。

## 代码事实

- `.github/workflows/npm-publish.yml` 的 beta job 串行执行四组集成，再运行 npm-release beta；install 已经是四平台并行，promote 等待 install。
- `scripts/smoke-integration.ts` 定义 22 个脚本调用。每脚本拥有独立现场，组内仍顺序执行；固定分组可以直接作为独立 job 的粒度。
- `service-package` 同时覆盖默认服务、四平台源码/许可/Skill/摘要、独立包和专用 registry 安装。`verify-packages.mjs` 需要完整候选目录和独立 Skill tarball；不能直接把只有主包/本机包的公共下载目录交给它，也不能删除这一组作为“重复”。建议整组继续在构建机器执行。
- access/storage/web 可从已核验的 Linux x64 公共 tarball 解包，仍需要验证源码、依赖和工具。web 的 hub-console-history.ts 直接导入 HAPI Web helper，checkout 必须包含子模块；access 需要实际 Codex 配置工具，web 需要 Chromium。storage 的两个 result-export 调用仍留在同组顺序执行。
- access 中两个较慢场景真实等待 HAPI 45 秒心跳过期，覆盖撤销/下线及目标选择安全边界。不能把真实时钟改成假时钟或粗暴减小超时来提速。
- npm-publish 每 5 秒轮询版本/标签，没有固定 10 分钟 sleep。元数据存在与 tarball 可下载不同时保证；downloadRelease 当前 GET 非 200 立即失败。
- metadata、标签和多个文件读取多处串行；有限并发可以降低请求往返，但不能承诺消除 npm 的服务端传播时间。
- 四个平台都会从公共 npm 下载主包和本平台 tarball并核验 SHA-512，再走真实 npm 安装；两步验证不同路径，均保留。事后另做的五包匿名下载可引用这些独立 runner 的下载证据，但包内内容/README/Skill 比对必须继续有明确检查。
- website-pages 与 npm 发布没有依赖关系；版本提交会提前触发公开 latest 校验而失败。官网部署目前验证唯一部署 URL，正式域名浏览器和额外摘要核对需要接入自动收尾。
- 构建仅 67 秒，不值得先引入跨发布二进制缓存或拆四个构建 job。普通 main CI 的重复根测试可另行优化，但当前只有约 79 秒且与发布并行，不是本轮重点。

## 验收与晋级实际含义

| 环节 | 检查内容 |
| --- | --- |
| access | 身份与空间隔离、资源访问、撤销凭据后断线、Runner 注册/离线、配置权限 |
| storage | 附件输入输出与留存、Git 导入导出、工作区准备、结果回收、Hub 委派 |
| web | Playwright 验证 Hub 页面、连接流程、后台配置与权限状态 |
| 四平台安装/卸载 | 公共 npm 精确版本下载与摘要、配对二进制、CLI/MCP、服务与信号、重装/缺依赖诊断、npm 卸载保留数据、完整卸载及失败重试 |

三组集成和四平台安装/卸载属于无模型验收，使用真实 Hub、Runner、CLI、浏览器和专用测试数据。完整卸载覆盖停止受管服务/会话，删除 Runweft 程序、配置、数据与备份，保留其他软件配置、模型凭据和用户项目。

优化方案中的“并行”只指上述七个验收 job。latest 晋级必须等待全部必需检查通过，再复查原包及标签，先更新四个平台包、最后更新主包的 latest。晋级复用已经上传并验收的版本，不重新构建或上传。

## 当前官网自动化与 agent 分工

| 工作 | 当前执行方式与入口 |
| --- | --- |
| 构建、部署及本次部署 URL 的文件 hash/MIME 校验 | CI 自动执行：`.github/workflows/website-pages.yml`、`website/build.mjs`、`website/publish.mjs` |
| 本地页面交互/布局、执行页面 DOM 中的 npm 安装命令 | agent 在当前机器主动运行正式脚本 `website/verify.mjs`；该脚本没有接入现行官网 CI |
| 正式域名文件及三页桌面/手机浏览器检查 | 本次由 agent 在当前机器执行临时脚本 `.dev-smoke/npm-uninstall-release/verify-live.mjs`，复用 publish.mjs 校验函数 |
| 各 job 输出验证证据 | CI 调用 `scripts/report-evidence.mjs` 写日志/summary |
| 跨 job/attempt 汇总、公开安装与包内 README/Skill 精确核对 | 本次由 agent 调度临时 collect-ci.mjs、verify-npm.mjs、verify-anonymous.mjs；均位于 `.dev-smoke/npm-uninstall-release/` |
| 验收文档、Specs 同步与归档 | agent 复核证据后完成 |

当前不存在覆盖全部收尾的固定自动入口。临时脚本未提交，包含本次版本、run id 或机器路径，不能直接作为下一次发布入口；可持久引用的结果见 [1.1.4 验收记录](../../archive/2026-10-12-npm-uninstall-release/acceptance.md)及同目录 verification.json。方案建议将所需校验参数化后接入 CI，并生成汇总供 agent 复核。

## 优化后的耗时预算

以下是未实施方案的估计，以本次约 10 分钟 npm 上传/传播为假设，不含 CI 排队、失败恢复和工程修复。

| 阶段 | 预计耗时 |
| --- | --- |
| 环境准备、类型检查和单元测试 | 4–5 分钟 |
| 四平台构建、包内容与服务检查 | 2.5–3 分钟 |
| beta 上传及 npm 公开可用确认 | 约 10 分钟 |
| 三组集成与四平台安装/卸载并行 | 5–6 分钟，按最慢 job 计算 |
| latest 晋级 | 约 1 分钟 |
| 官网部署、线上验收与自动结果汇总 | 3–4 分钟 |
| 自动发布链路合计 | 约 26–29 分钟 |

npm latest 预计在第 23–25 分钟可用。若上传/传播缩至 4–6 分钟，自动链路可能达到 20–25 分钟，尚无实测样本。最后 3–4 分钟以官网收尾接入自动流程为前提，不是当前已有一键脚本的耗时；agent 复核、Specs 整理与归档仍属额外工程收尾，未给固定时长。

## 合理推断与待实施验证

- 把 access/storage/web 放到 beta 后，三组与四个平台验收并行，可把“8.2 分钟集成 + 3.3 分钟平台验收”改为“1.7 分钟上传前检查 + 约 5–6 分钟并行验收（含各 job 准备）”，预计减少约 4–5 分钟。runner 排队和新增网络下载会影响收益。
- 增加三个 Linux job，验收阶段最多七个 job；会增加依赖准备和公共包下载流量，runner 总用量可能增加。需实测记录，不承诺零额外 CI 成本。
- 以本次去掉失败恢复后估算的约 28 分钟晋级时间为参照，采用上表预算。上一轮回复的正常全流程 30–40 分钟是含收尾的估计，不能当作另一次 CI 实测。
- 继续将传播约 10 分钟视为可变外部时间。并发查询主要节省请求往返，下载重试主要避免失败恢复和人工介入，不把二者重复计入大幅提速。

## iclaude 评审

2026-10-12 只读评审会话 `c99a8ada-26cd-4dee-a40b-46381445f685`，原始结果保存在 `.dev-smoke/release-throughput/iclaude-review.json`。主 agent 采纳：仅稳定版正式发布调整并行、保留预检/预发行四组、main dispatch 接续官网、元数据和文件共用重试截止时间、保留 beta job 名及增加脚本层 integration 断言、补齐 HAPI 子模块依赖、按单次实测保守估时。

评审指出恢复时 main 可能修改 Hub schema；当前 prepare 已通过 assertFrozenCandidate 拒绝 packageInputs 与 tag 不同，保留该限制即可。磁盘清理与 Chromium 准备有潜在优化，但磁盘容量尚无新实测，不计入承诺收益。
