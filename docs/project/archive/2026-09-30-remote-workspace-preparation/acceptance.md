# 远端工作区准备验收记录

按用户对本地自主验收和归档的持续授权，本 Change 通过验收。T1–T5 均有独立本地提交，未推送或发布；完整命令、结果和 HAPI 配套提交见 [Execution](execution.md)。这里验收跨 Runner 的基线和环境能力，不表示正式远端业务任务或代码回收已交付。

| 需求 | 可观察实现与证据 |
| --- | --- |
| Git 与明确基线前置 | 公共 resolve 拒绝非 Git、无 commit、歧义 ref、未提交子目录；CLI 必须传 base。HAPI workspaces/repositories 聚焦测试及 T3 真实诊断验证，无模型准备不调用 spawn |
| 主分支移动与脏文件排除 | T1 固定源身份/SHA，refs/config/index/工作文件不写入；T3 `.dev-smoke/workspace-preparation-M6ji4H/evidence.json` 的脏源子目录与 T5 `.dev-smoke/remote-native-Wmv8vP/evidence.json` 的移动分支/隐藏源目录，目标仍为准确基线 |
| 无 remote/未 push | T1 `.dev-smoke/repository-export-i3qiDt/evidence.json` 导出并发布完整 bundle；T2 `.dev-smoke/repository-import-pQhZMb/evidence.json` 在源路径不可用时独立导入，没有 push 或源 URL 回退 |
| 共享来源、独立环境与续接 | T2 同 cache 两工作树、模块与二进制 LFS、封存后沿成果继续；T5 一个 snapshot/import、两个独立环境，各 runtime 两轮复用同一 native session 和 worktree，新附件及上一轮记忆标记正确 |
| 准备后才启动 | T5 Codex/Claude 各六类错误 cwd/缺目录/HEAD/附件/gitlink/LFS 拒绝，childStarted=false 且 session 数不变；真实读取工程指令、skill、输入和 LFS 摘要。任务上下文的可用性沿已验收委派/附件流程，诊断不新增业务上下文版本 |
| 完整对象与能力缺失 | T1/T2 聚焦覆盖 sha1/sha256、递归子模块、LFS 缺失/损坏、shallow/partial 缺对象、损坏或增量 bundle 在暖 cache 中仍拒绝；T2 初始化不回退到源 URL/lfs pull |
| 原操作恢复与启动未知 | T1 export 丢响应/重启，T3 接受后立即重启 Hub，T4 丢 remove/unpin 回执；按原 ID 对账。实际 native start/resume 继续使用前置已验收执行回执，没有复制 spawn 重试逻辑 |
| 复用、留存和显式释放 | T4 `.dev-smoke/workspace-preparation-fbczK7/evidence.json`：dirty 不 checkpoint、ignored 明确放弃、另一消费者保护、离线 pin、跨快照 LFS pin 与最后实际缓存删除；cache 另有外部 worktree/未知 ref/未回收成果和中断删除保护测试 |
| 原生工具与停止 | T5 两 runtime 四轮实际目录没有 Runweft 工具，其他 MCP 被实际调用；Claude Task 保留。每轮退出后原 PID 消失；活跃 remove、封存后旧准备 resume 被拒绝，原全局配置摘要未变 |
| 可恢复字节与安装 | T5 两个 Runner 全部停止后仍从中心下载 Git/LFS 并校验摘要；四平台配套编译、五个 private 包。`.dev-smoke/install-Tvtrf4/evidence.json` 与 `.dev-smoke/workspace-preparation-08CBs0/evidence.json` 验证实际 npm 安装后完整准备、查询、重启和释放 |

根工程最后运行源码变更在 T4：全量 140 pass，最终聚焦 11 pass/214 assertions；T5 类型检查和四平台构建通过。HAPI 全类型通过；Web 3249、Shared 323、Relay 118 pass。CLI 全量 3014 pass/11 skip/2 fail，Hub 1411 pass/3 skip/1 fail：既有 `/tmp/.git` 导致 skills 非 Git 假设失败；Claude seam 与 Hub 节流计时用例单独复核分别 3 pass、4 pass。原始失败没有被省略或记为全绿，未改无关行为。

本轮真实运行与候选安装为 Linux x64，同物理机器的独立 Hub/source Runner/target Runner；其余 OS 只完成配套编译，真实跨物理机器网络未执行。前置四平台基础安装证据保留，但不替代本轮远端能力的跨平台实测。中心离线恢复文件能力已证明，业务代码结果取回仍由 C10 验收。

C10 使用 `RemoteBaselines` 的 `{snapshotId, origin, targetSource}` 并登记自己的 consumer，创建业务 environment 后继续已有 TaskFiles、TaskWorkspaces 和 TaskCoordinator；不接管诊断环境，不再复制 Git 准备、原生执行或附件服务。下一阶段必须补齐成果发布/取回才开放正式远端任务。
