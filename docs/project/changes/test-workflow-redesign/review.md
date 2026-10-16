# 测试与工程辅助流程评估记录

## 证据边界

2026-10-14 的 iclaude/traex 调用未产生有效架构意见。traex 两次正式调用分别等待约 26 分钟、20 分钟后终止；登录及 `openrouter-4o` / `xhigh` 请求配置已核对，但不等于完成评审。具体调用历史保存在此前 Git 提交；不将等待计作评审轮数。

2026-10-16 用户明确取消外部协作，要求主 Agent 自行多轮评估、launcher 放 src、减少目录与抽象。以下为三轮源码自审，既非外部独立意见，也非实现验收。当前实现未修改；每项“复核”指修订后的设计与源码证据核对，产品行为、性能及失败注入仍需实施后验证。

## 第一轮：职责与复杂度

### R1 不为职责标签逐层建目录

**证据/问题**：旧技术稿提出 integration 下四个领域目录、acceptance 下两目录、全局 support、scripts 下三目录和 packaging。现有工程工具仅 19 个顶层非 smoke 文件，且已有 scripts/tests；再拆目录不会减少任何运行成本。

**修订与复核**：只按三种成本分 test/core、integration、acceptance，领域使用文件名；scripts 保持平铺和现有 tests，npm launcher 放 src。辅助先就近复用，不预建通用层。对照 [全部 87 个脚本与根测试去向](research.md) 均有明确职责，没有以新目录替代实际收敛。

### R2 区分重复编译与必要的类型依赖

**证据/问题**：[compiled-cli](../../../../test/compiled-cli.ts) 缓存单个 Promise，[preload](../../../../test/preload.ts) 统一关闭；[checks](../../../../.github/workflows/checks.yml) 在根测试之后再 build。产品和测试引用 pin 的共享 schema/type，部分测试还导入 HAPI 实现，不能声称完全不依赖 HAPI 源码。旧稿为此拟拆多个 TS 项目，增加配置维护。

**修订与复核**：core 不编译/运行真实 HAPI 或 CLI；integration 消费已有明确构建。删除编译 helper/preload，保留单个 tsconfig 和独立全量 typecheck；后者诚实保留 HAPI 类型依赖。通过根测试导入调查区分实际 HAPI 实现与仅共享类型；不把 native 命名的替身测试全移成模型测试。

### R3 工具公共代码不归测试所有

**证据/问题**：[package](../../../../scripts/package.ts) 和发行代码使用 scripts/fixtures 下的来源/候选模块；npm launcher 被复制进发行包，属于交付运行资产。把整个 fixtures 目录移到测试会让生产发行反向依赖测试。

**修订与复核**：候选/来源模块移至平铺 scripts，由测试导入；launcher 移 src，包内路径不变。build-hapi/build/package 保留三种实际操作，不合成万能 CLI。`.d.mts` 按 Node/Bun 导出需要保留，不以文件数量裁撤。

## 第二轮：删除后的覆盖与复验反例

### R4 真实历史页面不能从摘要还原

**证据/问题**：[hub-console-history](../../../../scripts/fixtures/hub-console-history.ts) 要求未消费的当前交接，复制真实 Runweft/HAPI 数据库并读取身份与历史。旧稿“清理后让 web 消费新格式 native 证据”会失去所需现场。

**修订与复核**：真实页面验证进入 N1/N2 的同一 case、最终清理之前；来源副本与浏览器也归此 case 所有，副本禁用 Runner。之后仍按场景重启服务及 Runner，比较 session、轮次与历史摘要验证不重放。与当前 [shared 消费者](../../../../scripts/smoke-shared-package.ts) 的关键顺序一致；普通 web 使用固定当前样本，两者结果不混称。

### R5 删除工程交接必须承认复验粒度的变化

**证据/问题**：[collaboration-package](../../../../scripts/fixtures/collaboration-package.mjs) 的 live/unconsumed 现场可以独立消费；彻底删除交接格式后，无法同时无成本保留“接管旧现场只跑后半段”。再造断点协议会带回所有权、凭据与清理复杂度。

**修订与复核**：明确以单个 case 为最小重跑单位，未知状态先诊断，不能自动重发。成功 case 只按完全匹配的候选/验证输入显式复用结论；不接管旧现场。后半段失败可能多消耗一次该 case 模型调用，这是接受的取舍，以 preflight 和无模型回归降低发生率。首次失败和后续复验分开保留；必需集合、缺项、冲突与指纹必须校验，不因“可续验”重新建设调度器。

### R6 两个旧大入口仍含唯一保障

**证据/问题**：[HAPI 专项](../../../../scripts/smoke-hapi-session-and-shutdown.ts) 包含正常 SIGTERM、Hub SIGSTOP/断连、坏凭据、机器 ID 重用，以及 Claude 长非 Git 路径两轮原生会话延续。[execution](../../../../scripts/smoke-execution.ts) 包含同一 Codex 宿主的兄弟会话停止隔离；不是全部可由普通 collaboration 替代。

**修订与复核**：无模型进程保障进 integration，长路径进入 N2，控制/兄弟会话隔离进对应 C case；重建进 R case。保留源代码中的实际信号、原生 session/记忆与文件效果断言，不依赖将来某个 fork PR 才删除旧入口。N2 的 shared 场景本来使用非 Git 工作目录，加入长绝对路径不引入新的矩阵维度。

### R7 大文件相同不等于传输路径重复

**证据/问题**：artifacts/inputs/outputs 使用相同 72 MiB 大小，实际经过不同上传/输入物化/输出发布边界；workspace 长链还验证数量、LFS、离线、恢复和释放。

**修订与复核**：小样本承接普通权限/内容断言，三个传输专项及持续上传超时保留，公共数据生成函数复用。103 文件不再跟随每个工作区主路径；数量/LFS 的边界单独验证。下沉后的替代保障需以定向故障证明，不把“测试还在”视作同等覆盖。

## 第三轮：CI、候选和失败语义

### R8 早期范围判断不能引入漏选和假绿

**证据/问题**：[ci-scope](../../../../scripts/ci-scope.mjs) 忽略 test、scripts/tests、部分工作流路径；[checks](../../../../.github/workflows/checks.yml) 在准备依赖和根测试之后才调用 scope。历史文档 CI 的零 SHA 触发全部集成，不代表所有文档提交都会如此。

**修订与复核**：scope 在任何产品环境准备前执行；PR/default-branch merge-base、有效 push before/head、未知基线保守选择。测试/helper、旧新重命名、删除、scope 自身均有选择规则；汇总检查所选项失败/取消/缺结果。保留少量 job、条件步骤和现有子工程入口，不建依赖图或一文件一 job。无模型开发兜底与固定发行门禁分开，付费模型/发布不在兜底范围。

### R9 移除目录扫描时不能丢掉当前发布恢复

**证据/问题**：[report-evidence](../../../../scripts/report-evidence.mjs) 递归扫描 `.dev-smoke`，[website/recover](../../../../website/recover.mjs) 以旧路径识别 check/deployment/prepare；[npm-release](../../../../scripts/npm-release.mjs) 和 [release-finish](../../../../scripts/release-finish.mjs) 消费带候选、run/job 等身份的实际发布记录。

**修订与复核**：显式报告列表、带类型/版本的日志信封；官网生产与恢复同步改读 kind，保持上传回执、源提交与实际远端核验。独立发行标记有意义就保留，不强推全项目统一负载。旧格式拒绝，当前部分发布不能靠重新构建/重发恢复。实现验证必须覆盖缺失日志、冲突/错误候选，不能只测成功汇总。

### R10 现场清理与报告留存不能互相销毁

**证据/问题**：当前 [helpers](../../../../test/helpers.ts) 及多个 smoke 固定依赖仓库 `.dev-smoke`；成功报告和大目录混放，简单删根会丢报告，不删根又长期积累。setup 中途失败和关闭不确定不能按成功清理。

**修订与复核**：现场在系统/runner 临时目录，独立报告位置由调用方指定；入口唯一负责资源。逆序关闭继续处理其他资源，重复关闭共享结果；确认停机才能删大目录/临时秘密。停机未知明确失败并限制现场权限，不上传整目录。保留失败行为回归，不新增生命周期框架。报告退出状态包含清理失败，最终汇总不将未完成视作成功。

### R11 安装边界与实施切换保持具体

**证据/问题**：开发 Bun 命令不等于候选程序需要 Bun；tarball/symlink 与 npm launcher 有不同信号/路径边界，不能只选一种而称完整安装。现有 [MCP 配置测试](../../../../test/mcp-install.test.ts) 缺 Codex 会 skip，也不能沿用为必选验收的成功。

**修订与复核**：安装驱动用 Node，程序在 checkout 外只用候选；两种形态验证自己的部署保障，所选宿主缺失失败。五个职责交付都连同调用方切换并删除旧入口，CI 选择表同步；不单独交付空目录、兼容 alias 或没有消费者的新框架。

## 收敛结果与实现验证界限

[技术方案](technical.md) 已吸收以上反例：三个测试目录、平铺 scripts、src launcher、单 TS 配置、两个验收入口、按 case 复验、显式证据与当前恢复闭环。舍弃全排列、跨命令现场协议、递归扫描、多层目录和预建公共框架；保留有证据的产品保障。

本轮实际验证仅覆盖文档/流程一致性与清单完整性；没有执行产品测试、真实模型或新 CI 工作流，也未证明性能收益。实现阶段按技术方案的反例和同候选成本指标验收，不以本次三轮自审替代运行结果。

2026-10-16 校验：`node scripts/check-docs.mjs` 检查 346 份文档、900 个本地链接，0 错误；`node scripts/check-workflow.mjs` 校验 56 个 Change 通过；`git diff --check` 通过。对当前文件清单逐项比对，87 个 scripts 文件与 55 个 test 文件在 Research 中均有去向，无漏项。此次文档交付使用实际提交 hook 再检查暂存内容。
