# 实施记录

## T1 按改动选择 CI 检查与依赖

开发工作流先在 Node scope job 确定范围与执行文档/流程检查，checks/prototype 仅按结果运行，最后汇总拒绝失败、取消或缺失的必需结果。修复首次 push 零 SHA、PR merge-base 与测试路径漏选；本地同一入口支持显式基线和工作区改动。官网仍由所属工作流负责，安装/native 范围为后续入口及人工验收提供选择依据，当前未将建议冒充已执行。

验证：Node 工具测试 56/56 通过（含 3 个 scope 契约测试，使用真实 Git 仓库验证首次 push、分叉、重命名、删除及未提交文件）；actionlint v1.7.12 通过。以 origin/main 到 170d47e 的实际文档差异运行 scope，core/tools/kit/prototype/website/install 均 false、groups/native 为空。新工作流的 Actions 实际运行证据待后续提交后读取，当前结果是本地验证。

开始交付 `docs/testing.md` 的现行范围选择说明，其余操作随对应入口补入。尚无产品测试/模型执行结果，不把旧 Claude 实测作为本次运行。
