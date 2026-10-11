# HAPI 修复与 macOS 校验发布验收

> 结果：已完成，2026-10-11
> 用户授权：自动验收、推送main与正式发布；不重复人工门禁。

公共五包latest/beta=1.1.3；[发布CI](https://github.com/iTgo-lyq/runweft/actions/runs/38149709526)的四平台安装和OIDC晋级成功，[生产官网](https://runweft.pages.dev/)安装1.1.3。发布、安装、核心和官网均无Actions artifact依赖。

## 来源

不可变v1.1.3源码`dab91e089c63a64a4d275a81b7b793354d86200b`，固定HAPI`8f774b9413fd483bc163cc06425d7646f10a7c92`（CLI0.30.7/protocol1）。原v1.1.2源码ee66fe08及已公开包保留；该候选两Mac安装失败，未晋级latest。修正版本不覆盖旧tag或npm字节。

## 验收对应

| 交付 | 实际证据 |
| --- | --- |
| HAPI/Runweft main与固定修复 | HAPI main为8f774b94；Runweft main包含对应gitlink，v1.1.3为其祖先，包输入冻结 |
| beta先上传、四平台验收、latest晋级 | 同一CI原候选描述、五包公开完整性、四平台job success、平台先/主包后OIDC dist-tag写入 |
| npm权限 | 用户浏览器配置；真实发布与标签写入成功确认两种权限，不保存长期token |
| macOS数据库校验 | 原生两Mac旧回归各7通过/1失败；修正后各8通过/0失败/93断言，私有读写副本通过且原目录字节不变 |
| 匿名安装与内容 | 五包实际匿名下载SHA-512/manifest匹配候选；网页DOM安装Linux x64后两个程序SHA-256、六Skill文件与两份README匹配冻结源码 |
| 生产官网 | [生产CI](https://github.com/iTgo-lyq/runweft/actions/runs/38151944692)；唯一URL与正式域名八文件摘要/MIME，正式域名三页Playwright通过 |
| 当前工程 | 249项本地完整根测试、43项Node、类型/build通过；[main CI](https://github.com/iTgo-lyq/runweft/actions/runs/38149695886)通过；发布CI完整候选检查通过 |

## 四平台公共安装

| 平台 | GitHub job | 结果 |
| --- | --- | --- |
| darwin arm64 | 114505399817 | 六组安装/服务检查通过 |
| darwin x64 | 114505399825 | 六组安装/服务检查通过 |
| linux x64 | 114505399882 | 六组安装/服务检查通过 |
| linux arm64 | 114505399889 | 六组安装/服务检查通过 |

每个平台从公共npm安装精确1.1.3，核验Runweft与相邻HAPI的候选摘要，完成MCP目录、无Bun服务/信号、重装、缺依赖错误及卸载保留。五包SHA-512、四平台二进制SHA-256、job/日志摘要保存在[脱敏验证记录](verification.json)。

## 修正与保留

macOS系统SQLite读取WAL模式且无边文件的只读验证副本时报SQLITE_CANTOPEN。只把临时副本改为readwrite/create:false，允许SQLite在临时目录构建边文件；原数据库/WAL/SHM和身份配置不写入。schema19/client1/config1不变，旧/未知/损坏格式仍拒绝，未加入迁移或历史兼容。

旧artifact额度失败、目录与浏览器验收修正、1.1.2 Mac失败和日志恢复记录保留在[执行记录](execution.md)。四份旧候选按用户远端授权删除前已完整备份校验；其余远端回执与npm历史包保留。未知/部分上传禁止自动重建重发。

本轮四平台是托管原生机器的安装/服务验收。未追加模型调用，不以此代替用户物理机器、Mac/arm64模型或跨机/WAN实测；Claude长cwd两轮及Runner正常/失联/撤权退出仍引用原专项候选证据。

## 关闭

按持续授权完成自动验收、同步发行/安装/Skill/官网/部署Specs并归档。官网静态输出8文件91,656字节，未生成新离线整包。任务提交见[Execution](execution.md)。
