# 当前数据基线与测试环境清理方案

> 来源：./requirement.md
> 更新：2026-10-10

## 依据

`src/state.ts`实际常量为Hub19、client1，`src/config.ts`接受config1；公开v1.1.1的Hub18仍由现有代码拒绝。用户确认没有其他机器部署，故不增加旧格式迁移。清理属于一次开发操作，HAPI没有需要补齐的产品接口，本次不改造runtime。

本机当前仓库 `.dev-smoke`约64GiB、历史仓库约4.6GiB；`~/.runweft`约350MiB。已发现dashboard测试Hub及旧1.0.0本机公共测试Hub，后者使用`~/.runweft`。另一组npm HAPI进程位于codex-delegation-lab，与Runweft测试目录无关，保留。

## 实施

1. 根据目录实际归属生成固定绝对清理清单：`/home/tiger/workspace/runweft/.dev-smoke`、`/home/tiger/workspace/runweft-archive/.dev-smoke`、`/home/tiger/.runweft`，以及本次实际列出的`/tmp/runweft-*`、`/tmp/rw-collab-*`和`/tmp/rw-t6`测试目录。历史仓库origin为`github.com/iTgo-lyq/runweft-archive.git`；两仓库均无注册在清理范围中的worktree。临时目录按前缀、实际测试内容和当前UID核对，记录根inode/dev并在删除前重查；拒绝符号链接、挂载点、非白名单路径、跟踪文件和源码根，不沿符号链接递归。空的`/tmp/rw-t6-active`测试标记同时删除。
2. 保存用户原生配置/凭据原件的内存摘要，记录目标目录占用、路径、相关PID及启动身份；不输出原件或秘密。停止时再次核对PID启动时间与路径，向目标进程发送TERM并有界等待，必要时只对相同身份的残留PID发送KILL。不使用名称通配kill或误杀独立HAPI。
3. 扫描`/proc`的cwd、exe、特定数据路径环境变量和文件描述符。目录仍被进程使用时停止删除并定位；无占用后逐一删除清单目录。清理是用户已授权的不可逆删除，不再保留整份测试环境备份；历史验收摘要保留在已跟踪归档。
4. 删除后使用现有`initializeConfig/loadConfig/openState`在专用新目录验收当前格式的创建和重开，显式home且配置环境为空，重开后读取19/1/1；关闭数据库后清理现场，核对默认home没有被重建。只在持续维护文档明确首次部署基线，不改历史归档或虚构发布结果。

原生配置只有四条指向历史测试目录的Codex projects信任表键，没有测试MCP/hook执行依赖；保留这些原生配置字节，删除其已授权的历史目录。保护对象的realpath不在清单中。保留`~/.local/bin/runweft`及`~/.local/share/runweft/releases/1.0.0/bin`，不重启旧安装。systemd/autostart/cron未发现Runweft自启动项；清理后等待三秒复扫路径与进程占用。共享npm/浏览器缓存和其他HAPI临时目录不属于清单。

## 验证边界

只改文档与测试现场，不重新运行模型或产品全套测试。本次自动验收检查清单路径不存在、相关进程退出、保护对象摘要不变以及新格式创建/重开；发布、远端CI、真机和跨机验收继续保持原缺口。
