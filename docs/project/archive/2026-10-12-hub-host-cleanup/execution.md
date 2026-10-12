# Hub 安装前清理执行概况

## T1 清理残留并验收归档

- 结果：删除旧 Runweft 1.0.0 安装、runweft/runweft-hub 两个入口及已确认的无占用测试/临时文件，共 753 项，删除前实际占用 5,460,295,680 字节（约 5.09 GiB）。该值是固定清单占用，不声称为整机可用空间的精确增量。
- iclaude：会话 `4e4b5ccd-24d1-4ee5-92fb-e5ed8230a6d6` 一次 Plan 评审完成；采纳情况见技术方案。额度未耗尽。
- 验证：固定根身份/属主、嵌套挂载、进程 cwd/exe/fd/maps/参数/数据环境与 Unix socket 预检通过；三秒延迟复扫无清单残留、重建或占用。没有停止进程或提权，未修改目录权限。
- 保护：38 项文件在内存中前后摘要一致；25 份备份文件自包含、原备份索引摘要一致。源码/Git、正式 dist、原生配置和凭据保持；独立 HAPI 两 PID/starttime 与 11298 监听保持。
- Hub 就绪：PATH 中旧 Runweft 已移除，~/.runweft 不存在、3210 空闲。未安装新版或启动 Hub。
- 保留：1.8 GiB 远端旧候选唯一备份、独立 ~/.hapi 与两处通用 hapi-blobs、用途未确认的 /tmp/hapi-debug-TBQz1k（约 1.3 MiB），以及四个原生 Codex 历史测试信任键。不会自动改用户原生配置。
- 范围：仅本机环境清理，无产品行为变化；无需 Specs 改动、构建或模型验证。原始可丢弃测试现场已删除，历史仓库验收摘要继续保留。本次临时脚本和评审原始输出在归档记录保存后删除。
- Commit：`hub-host-cleanup T1: remove legacy installation and idle test environments`
