# 完整发行实现前复核

## 干净源码的依赖顺序

2026-09-30 用当前根提交 `cdca599` 与固定 HAPI `92225a8043987190690187c82149b9ac62afcd09` 分别 git archive 到 `.dev-smoke/release-clean-4nDz3s`，未复用开发 checkout 的 node_modules。实验不更改正式运行代码。

- 现有 `.github/workflows/cli-install.yml` 在 root `bun install --frozen-lockfile` 后立即执行 types/tests，HAPI 依赖只在之后的 package 构建时安装。
- 实际 root install 成功，但 typecheck exit 2：缺少 HAPI `@hapi/protocol` 工作区链接及 tests 直接引用的 HAPI hono 模块等。日志为该目录 install.log/typecheck.log。
- 在同一副本补 `bun install --cwd hapi --frozen-lockfile` 后，root typecheck exit 0；日志 hapi-install.log/typecheck-after-hapi.log。因此正式发行需在 types/tests 前显式安装固定子仓库依赖，并同步源码开发说明；不是产品安装要求用户安装 Bun/HAPI 第二 CLI。
- 补装后同一干净副本运行 `bun test ./test`，158 pass / 0 fail、3511 断言，tests.log 保存结果；没有调用原生模型。
- 完整发行阶段仍需对最终候选重新核对干净构建、安装与运行；以上只证明当前顺序缺口及最小修正路径，不代表最终发行已验收。

## 当前上游测试的环境限制

C10 的 HAPI CLI 全量检查有一个已记录失败：`skills.test.ts` 的“非 Git 仓库只读取 cwd skill”用例在本机 `/tmp/.git` 下运行，实际多读取了父目录 skill。2026-09-30 单独重跑该文件并设置 `GIT_CEILING_DIRECTORIES=/tmp`，仍为 27 pass / 1 fail，见 `.dev-smoke/release-research/hapi-skills-isolated.log`。

源码 `listProjectSkillsRoots` 直接逐级检查 `.git` 文件系统路径，不调用 Git，因此该环境变量不改变边界。未删除 `/tmp/.git`，未修改 HAPI 或测试断言；此失败继续保留，最终发行不能据此声明上游全量通过。

## 发行物与安装证据

当前 `scripts/package.ts` 为主包及四平台包都写入 private:true，描述也仍是 candidate；这是本地候选组织，不是可直接 npm publish 的发行清单。源码工程自身继续 private，生成的交付包解除 private 并写明固定版本、平台与配套 HAPI，打包不执行 publish。

所有阶段候选沿用 0.1.0，而 status 的重启提示依据 Runweft version 或 HAPI revision 差异。正式交付选 1.0.0，可以直接沿现有提示区分已装新程序与仍运行的旧候选，无需新增 build-ID 运行协议。升级试验将保留一组当前 0.1.0 二进制，与 1.0.0 使用同一专用数据根检查升级/兼容回退；不改用户机器上的实际服务。

2026-09-30 只读查询官方 npm registry，`runweft` 及四个 `runweft-<平台>` 名称均返回 HTTP 404，证据 `.dev-smoke/release-research/npm-names.json`。这只是当时没有公开记录，不证明发布权限或保留名称归属，也没有申请名称或上传包。发布权限在实际发布时检查。

C11 已对当前 CLI 代码编译四平台，并在 Linux x64 通过真实私有 registry 安装：`.dev-smoke/install-FL0qpY/evidence.json`、其 service-PLAuM6 及 `.dev-smoke/remote-package-Vyp7Bt/evidence.json` 均成功。验证了内嵌看板资源、同一认证、旧原生任务事实、离线成果取回和不增加 sessions；不能把交叉编译当成当前 macOS 原生运行。

最终证据应绑定实际 Runweft/HAPI 二进制 SHA-256、包 SHA-512、源码 revision 与固定 HAPI revision，避免同为 0.1.0 的不同阶段候选被误认为同一版本。已有 index 记录包 hash，可以扩展这一清单；不另建用户运行数据或新的安装服务。

## macOS 环境

只读复核 [C1 四平台 CI](https://github.com/iTgo-lyq/runweft/actions/runs/36478994571)：head `846caf386670997aca854bfee051c2ccf54a4712`，build、macos-15 arm64、macos-15-intel x64、ubuntu-24.04-arm 均 success。它只覆盖那个早期提交的无模型安装/服务，不能证明当前最终原生协作。

Codex app 的项目目录可见本地 `/Users/bytedance/...` 项目，但本会话执行工具只连接 Linux `lyq-dev-ultra`；当前可调用工具没有跨主机命令入口，SSH 配置及其 Include 中也未找到 Mac 目标。存在 Mac 项目不等于取得了执行权限或连接。已询问可自动执行的 Mac SSH 入口或任务执行主机切换方式；不要求用户手工验收、不索取或迁移模型秘密到 CI。

当前 CI 可自动做四平台安装，但不能运行未推送的最终代码，也没有已授权的原生模型认证。没有为此 push、workflow_dispatch 或上传凭据；最终 macOS 原生验收仍是明确前置条件。

## 原生历史缺失后的重建

此前真实证据证明两种 runtime 的 resume 与缺失诊断；C6 acceptance 明确区分，完整缺失重建当时只通过 HTTP/SQLite fixture。本次 Research 补充现有编译产品的真实业务重建，最终发行仍需对同一正式候选验证，不能用此前诊断或开发候选直接替代。

当前路径可复用：TaskCoordinator 在原生 resume 返回 missing 后调用 historyContext，再经同一 HAPI 受控启动投递新轮次；unknown/离线不会进入该分支。historyContext 限最近六轮、任务/追加/报告分别截断，不复制原生 transcript 或凭据。

2026-09-30 04:54–04:57（Asia/Shanghai），使用当前 `07a6ac2` 编译产物及固定 HAPI，通过正式 CLI 在专用 home 完成两种 runtime 的首轮，再重启同一 Runner 身份并切换到仅有同等配置/认证、没有历史的新原生 home。Codex 0.156.1、Claude Code 2.1.283 均沿真实 missing 分支完成第二轮，无产品改动。证据 `.dev-smoke/reconstruction-LK5enT/evidence.json` success=true、cleanupErrors=[]，同时记录程序 SHA-256。

- 第一轮的随机记忆只在旧业务输入中，未写入工程文件或旧报告；第二轮输入不提供该值。新会话仍能正确返回，证明业务历史摘要实际到达模型。
- 两种 runtime 均返回 resume.outcome=missing、reconstruction.reason=native_session_missing，来源仅含原首轮 ID；产生新的 HAPI/native session ID，保持原任务、runtime、机器和 cwd。
- 只读核对两份新原生 transcript，每份恰好一条包含本轮标记的 user 输入，且含旧记忆。旧 transcript 的 SHA-256 未变，旧报告不变，共享工程目录保持为空。四轮执行对应四个已归档会话，所有执行 PID 已退出，专用服务停止。
- 首次脚本只查 Codex sessions，漏了原生停止后转入的 archived_sessions，导致定位断言失败；通过原生索引确认真实历史仍在后，继续同一已完成任务，没有重新执行 Codex 首轮。失败保留在 attempts 中；续接和原生输入核对日志为 `.dev-smoke/release-research/reconstruction-{continue,audit}.log`。

研究入口 `.dev-smoke/research-reconstruction.ts` 与只读核对脚本 `.dev-smoke/reconstruction-audit.ts` 未进入交付代码；最终 Plan 可据此复用真实验证路径。这里验证共享目录的历史重建，不声明独立工作区、附件、最终发行包或 macOS 组合已经通过。
