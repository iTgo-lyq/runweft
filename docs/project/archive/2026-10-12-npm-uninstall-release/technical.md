# 1.1.4 发布技术方案

> 更新：2026-10-12

用户发布授权与 AGENTS.md 的方案/自动验收授权持续有效。原 main 是当前分支祖先，两侧无冲突或契约分歧，直接正常快进推送；不改历史，不创建额外合码方案。

冻结 1.1.4 根版本、常规使用说明与 Skill，删除源码维护区的未发布提示；归档 1.1.3/完整卸载证据保留历史状态。官网对话和维护文字交给 iclaude 修改，框架不变。HAPI pin/schema 不变。

将已有完整卸载 smoke 接到四平台公共安装矩阵：公共下载校验仍由原 npm-release download/smoke-install 完成；完整卸载脚本接受候选目录和独立证据路径，直接引用校验过的原平台 tarball，不重打平台包。fixture 主包仅修改 optionalDependencies 为本地文件路径；实际两程序 SHA-256 核对 index，内容/版本均属于原候选。控制整包在第一次安装前复制到独立目录以保留第二 Hub/清理入口；PATH 仅保留 Node/npm 与系统工具，预检 ps/tar/git、Mac lsof。Claude 用真实 mcp install 验证备份/hook，Codex 注册直接构造以证明移除不依赖 Codex 客户端。其余既有删除、拒绝、重试和保护断言保持。四平台步骤不容错，脱敏 evidence.json 由原 report-evidence 输出日志；超时改为35分钟。

T1 完成类型、根测试、Node 发布检查、构建、Linux 完整卸载和网站构建/Playwright后提交。推送不可变 tag 触发发布，main 正常快进同步；若官网因 npm 尚未公开失败，npm latest 验收后从最新 main 重新触发官网。tag 与控制源码的 packageInputs 必须完全一致；公开候选若失败，只恢复已有包或发新版本，不覆盖版本。

最终读取 beta/install/promote 实际任务日志和候选描述，匿名核对五包及 tarball 摘要，保存脱敏证据；部署后的官网逐文件/三页自动检查。版本、发行/安装/Skill/官网 Specs 只在实际结果确认后更新，归档提交继续推送 main。

## iclaude 评审落实

会话 fec14f86-2218-41af-9ebf-8cb16b3d689b 成功，主 agent 采纳包来源、控制副本时序、去模型客户端依赖、Mac系统工具PATH、同install job门禁与日志证据意见。Codex采用直接构造已知注册，不另实现假原生客户端。未采纳延后main的建议：用户明确要求合入且官网check逐包要求latest已晋级，提前main推送不会发布未晋级页面；原 npm-publish promote 也实际传入 needs.install.result。main与tag正常原子推送保证恢复入口已经含新矩阵；npm晋级后从最新main触发生产官网。

## 首次 CI 门禁失败与恢复

原run38237215063在Hub浏览器过期测试的auth请求计数失败（5!=4），未进入上传步骤、未输出上传开始或候选描述，匿名五包1.1.4均404。相同旧测试的main CI和本地单项通过，存在时序不稳定。旧测试在应用timer已运行的共享context上安装clock；[Playwright官方Clock说明](https://playwright.dev/docs/clock)要求在应用计时器调用前安装，且context内页面共同受影响。

只调整验收fixture：原tab重载核对JWT不变；新的独立browser context在首次导航前安装clock，携原短JWT验证过期清理/返回Hub/零新auth申请，不影响其他Hub/native标签；原安全断言保留。typecheck及完整console单项通过，包输入与v1.1.4完全一致。推送main修正后使用release-tag=v1.1.4、source-run-id=38237215063恢复；prepare在确认未上传和版本不存在时允许从原tag重新构建。产品源码、HAPI、版本及tag不变，不覆盖npm包。

恢复run的托管Runner在集成阶段磁盘耗尽，API记录上传步骤仍pending。标准托管Runner的可用SSD空间为14GB（[GitHub官方规格](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)）；发布job先清除不参与Bun/Node/HAPI构建的预装Android/.NET/GHC以释放空间，每组结束记录磁盘占用。只影响一次性CI机器，原候选和用户环境不清理。日志未保存的失败不假定任何集成通过；用已保存的首轮日志与公开版本不存在的证据恢复同一tag。
