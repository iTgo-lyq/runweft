# 1.1.4 正式发布验收

2026-10-12 按用户的主干合入/发布及自动验收授权完成。全部产品代码已合入 main，五个 npm 包 latest/beta=1.1.4；正式官网同步版本与完整卸载说明。原 v1.1.4 不移动，旧包和历史归档不改。

| 目标 | 实际证据 |
| --- | --- |
| 全部代码合入 | 原4个提交均为main祖先；HAPI固定8f774b94及其远端main一致，没有未合入的本地分支 |
| 同候选正式发布 | 不可变tag源码3f873788b11926d2e51c9ccf9f3f661dc239ab6a，source.dirty=false；[发布CI](https://github.com/iTgo-lyq/runweft/actions/runs/38241538144)完成beta/四平台/latest，原包未重发 |
| 四平台安装与完整卸载 | Linux x64/arm64、macOS x64/arm64均从公共npm安装，下载SHA-512和两程序SHA-256匹配候选；默认服务/信号/MCP目录/重装/npm卸载保留及各8组完整卸载通过 |
| 删除和保留边界 | 真实Hub、双连接Runner、当前/恢复登记控制测试进程停止；MCP/hook/三个Skill路径/程序/home/全部备份消失。失败保留数据并可重试，独立包/PATH链接实际自删除；其他软件配置、模型凭据、原生历史和源项目内容保持 |
| 匿名公开包核对 | 五包全文下载摘要全部匹配原候选；Linux x64从实际网页DOM安装，两程序、主/平台六个Skill文件与README匹配冻结源码 |
| 官网 | [生产CI](https://github.com/iTgo-lyq/runweft/actions/runs/38245448709)成功，固定[6c712b0f.runweft.pages.dev](https://6c712b0f.runweft.pages.dev/)与[正式域名](https://runweft.pages.dev/)十文件摘要/MIME匹配，297,785字节；正式域名三页两宽度浏览器、本地三页六宽度/两图/27链接/复制及匿名安装通过 |

本地typecheck、build、260项根测试（4889断言、42文件、67.33秒）、43项Node检查与8组Linux完整卸载通过。发布CI的根测试为260项、4888断言、71.77秒，access/storage/web/service-package共22脚本全部通过；[main检查](https://github.com/iTgo-lyq/runweft/actions/runs/38241523109)为260项、4889断言、76.76秒。后续文档提交保持packageInputs与原tag完全一致。

首次web过期计数失败修复为导航前安装的独立clock context；随后并行单测按HTTP到达先后分配gate导致反序等待，已按operationId绑定并强制反序到达。一次托管Runner磁盘耗尽有API annotation，上传步骤仍pending、日志未保存；仅清理CI预装不用的Android/.NET/GHC，实际可用空间14GB→31GB。beta成功后Linux arm64首次下载tarball返回404，随后同URL GET 200/摘要一致，仅重跑失败job与晋级，其余成功结果复用。所有失败与实际执行/复用job、摘要见[verification.json](verification.json)，没有用重试改写首次失败。

会话是登记到真实HAPI的控制测试进程，不冒充Codex/Claude模型协作或物理远端/WAN验收。HAPI修复已有原生模型证据留在此前归档，本轮没有追加该模型组合。Plan由iclaude会话fec14f86-2218-41af-9ebf-8cb16b3d689b评审并重写官网维护文案，主agent独立落实。

发布/安装/官网没有Actions artifact交接；凭据不写入网站或验收JSON。真实用户全局配置、模型凭据、项目及独立HAPI未改，默认Runweft home与全局命令仍不存在；专用安装和服务清理后可按当前说明从空环境安装Hub。当前schema/config格式不变，历史测试格式不新增迁移或产品自动清理。
