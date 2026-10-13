# 执行证据

## T1 冻结 1.1.7 版本与安装说明

在独立 worktree `/home/tiger/workspace/runweft-release-1-1-7` 更新 package.json 与 docs/usage.md 的当前版本为 1.1.7；纠正 docs/release.md 一处仍写官网在晋级后串行启动的旧描述，与已实现并行行为保持一致。没有修改程序或验收实现。

Bun 1.4.2 冻结安装及原 HAPI pin 初始化成功；70 项 Node 检查全通过，稳定官网构建输出 1.1.7，十文件与安装提示校验成功。文档、workflow 和 diff 检查通过。已查询当前五包 latest/beta 为 1.1.6，主包 1.1.7 返回 404；正式发布脚本仍逐包检查是否已有版本。

此处仅为源码准备验收，不是 npm 或官网 1.1.7 已发布的证明。合入后由正式 tag 工作流执行全套发行 gate，实际结果与耗时另存 docs/releases/1.1.7.md 及结构化时间文件。
