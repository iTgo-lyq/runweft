# 实施记录

## T1 按改动选择 CI 检查与依赖

开发工作流先在 Node scope job 确定范围与执行文档/流程检查，checks/prototype 仅按结果运行，最后汇总拒绝失败、取消或缺失的必需结果。修复首次 push 零 SHA、PR merge-base 与测试路径漏选；本地同一入口支持显式基线和工作区改动。官网仍由所属工作流负责，安装/native 范围为后续入口及人工验收提供选择依据，当前未将建议冒充已执行。

验证：Node 工具测试 56/56 通过（含 3 个 scope 契约测试，使用真实 Git 仓库验证首次 push、分叉、重命名、删除及未提交文件）；actionlint v1.7.12 通过。以 origin/main 到 170d47e 的实际文档差异运行 scope，core/tools/kit/prototype/website/install 均 false、groups/native 为空。新工作流的 Actions 实际运行证据待后续提交后读取，当前结果是本地验证。

开始交付 `docs/testing.md` 的现行范围选择说明，其余操作随对应入口补入。尚无产品测试/模型执行结果，不把旧 Claude 实测作为本次运行。

## T2 删除已确认的低价值测试和不可达分支

删除 24 个指定测试块及无用 import，website-build 整文件删除；collaboration 删除不可达 CONTROLS/DISCONNECT 分支和唯一使用的 43 行 mcp-cut 代理。没有补等量测试，保留配置写入失败、数据库/WAL 保全、真实 HTTP/字节、任务不重派、真实进程强杀失败和发布不可重复写入等已有保障。原生 main/专项及交接机制在后续任务切换，本次未调用模型。

定向 Bun 测试 40/40 通过（10 文件、757 个 expect、18.79 秒），Node 工具测试 50/50 通过，类型检查通过；文档/流程及 diff 检查通过。首次类型检查发现删除三元分支后留下的逗号，已修复并重新通过，不将首次失败隐去。

删除旧测试后暴露历史归档的本地链接依赖。未修改只读归档，文档检查对当前不存在的归档引用使用归档加入时的 Git tree 核对；当前文档仍要求现行文件存在，历史中也不存在的链接仍失败。实际旧 website-build 引用已按该方式核验。

## T11 修复轻量文档校验的 submodule 隐含依赖

T1 的 Actions run 38994958028 在 scope 的文档检查失败：54 个历史/现行链接指向尚未初始化的 HAPI，checks/prototype 被跳过且 result 正确报错。没有把该 run 报作成功，也未初始化 HAPI 来维持文档-only 的隐藏依赖。

文档检查现在明确报告未准备外部树的链接未验证，产品检查准备 pin 后再次核验；根仓当前/历史引用仍执行原有校验。在新建的无 submodule、无 node_modules checkout 复验：349 文件、899 个本地链接、0 错误，54 个 HAPI 链接明确 deferred；流程检查通过。当前已准备 pin 的工作区：953 链接、0 错误。actionlint 与 diff 检查通过。后续 Actions 结果继续跟踪；这是 T1 的追加修复，不覆盖其首次证据。

## T3 用真实接线试点 Bun 集成与关闭语义

235 行 hub-configuration 长链替换为 91 行 Bun 集成：保留实际 CLI/Gateway/HAPI Runner 的 Agent 选择与解析、runtime 撤销和错误身份拒绝，删除多层重复治理、参数和展示矩阵。当前整体入口和 scope 已切换到同一测试，默认根测试暂显式限制在根层文件；没有保留旧 smoke 转发文件。

共享关闭函数合并并发/重复关闭结果，逆序尝试全部资源；owner hook 在 Bun 超时后仍等待实际退出。真实子进程超时测试已证明该行为；忽略 SIGTERM 的强杀测试将宽限改为 30ms，从约 5 秒降至约 40ms，仍要求失败和进程消失。

实际验证：重建 dist/runweft（复用匹配 pin 的 HAPI）；真实 Hub 配置接线 1/1 通过，4.72 秒，无模型；关闭/超时/旧分片接线 8/8 通过，新增超时 hook 后生命周期文件 3/3 通过。首次真实链发现 Agent definition 缺少 flavor，服务拒绝输入，修复后通过；类型检查发现访问私有 Store 字段，改用现有 gateway Store。失败及成功后的专用运行根已由 owner 清理。文档/流程和 diff 检查通过，现行说明已同步。
