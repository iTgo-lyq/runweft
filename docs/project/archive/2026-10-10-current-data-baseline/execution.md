# 执行与验收记录

## T1 基线与边界

已核对源码基线`afdcd81a4e062f56edab533b9874f266b70f655b`、工程1.1.1及Hub19/client1/config1。首次专用现场实际创建、校验并重开数据库和配置通过，临时现场已删除；删除完成后再进行一次独立创建/重开验收。

iclaude在当前工作区完成一次无工具、无会话持久化Plan评审，退出0、is_error=false、196804ms。采纳固定绝对清单、根身份/挂载校验、原生路径引用检查、启动来源检查、删除后基线验收和延后复扫。摘要比较窗口位于评审结束之后，敏感摘要不写入归档。没有采用无依据的完整迁移框架或保护所有HAPI的建议：目标测试Hub的HAPI需随其停止，无关HAPI继续保护；Task实际已有version2，不添加预设版本系统。

用户升级基线确认写入AGENTS：后续结构变更在对应Change明确从该基线起的处理与验证；此次不新增迁移代码。历史仓库remote及Git worktree核对完成；未发现Runweft自启动配置。原生Codex仅有四个历史测试项目信任键，保留原配置；这些引用不构成持续运行或MCP依赖。

保护当前及历史仓库源码/Git、正式dist、已有Runweft安装、原生配置/凭据和位于codex-delegation-lab的独立HAPI服务。清理只删除固定清单内测试现场，不删除共享缓存或`/tmp`中的其他项目/HAPI目录。

- Commit：`current-data-baseline T1: establish first-deployment baseline and cleanup scope`。

## T2 清理与实际验收

固定16个目录清单删除前占用77,488,615,424 bytes（约72.17GiB）。目录清单及停止/保护结果见verification.json，不含测试目录内用户源码、prompt或凭据。该数值是清单原始磁盘占用，不是跨时间测得的精确可用空间增量。

按PID/starttime核对并停止3528020、3528033、3982064、3982079、3982127；最终均不存在。测试监听40307和9251均已关闭。独立HAPI的2713294/2713304仍以原starttime运行，历史仓库HEAD仍为39f9de99ce2bcac9dbaddf2d0b76866171d772c2且工作区干净。

首轮删除完成两个仓库.dev-smoke和默认~/.runweft后，遇到/tmp/runweft-artifacts-mpvcJP内一个当前用户所有、mode0500的只读对象目录，删除返回PermissionError。未扩大路径范围或使用sudo；确认属主/dev/目录归属后，仅为该测试目录补充用户写权限，继续删除剩余13根目录及空的/tmp/rw-t6-active标记。最终无失败或残留，等待三秒再次确认无目录重建、cwd/exe/root/fd/maps/相关数据环境变量占用。

首轮私有摘要记录位于随后已删除的.dev-smoke，权限失败使该轮后置对比没有完成。续清理改为在工具会话内存保存摘要，15项保护对象（含原生配置/凭据、安装程序、dist关键文件与两个Git目录）在续清理和新格式验收后均一致；不声称首轮失败窗口已有完整摘要比较。所有清理写入、权限调整及删除均限定已授权测试路径，原生原件未被这些操作修改。

清理后以保留的dist/runweft在显式专用home及最小子进程环境执行init和config check，均退出0；源码openState实际创建、验证、重开并读回Hub19/client1，config为1。Bun1.4.2，产品源码与基线afdcd81相同；当前执行提交为T1的dcc7fdc。关闭后删除专用home及临时.dev-smoke，默认~/.runweft未重建，续清理前的保护摘要仍一致。当前dist/packages仍是保留的历史1.1.0发行产物，不当作当前首次部署候选。

产品代码、模型适配和发布流程未改，不重复整套类型/根测试/构建或模型验收；上一轮本会话执行过的248根测试、33Node检查、typecheck/build结果没有冒充本次环境清理验证。无push、tag、npm上传、其他机器操作或官网部署。

- Commit：`current-data-baseline T2: clear historical local test environments and verify fresh data`。

## 关闭

依据用户已授权的自动本地验收，清理需求及当前格式初始化/重开已通过；首轮摘要比较缺口明确保留，不作为已执行的验证。同步deployment基线和项目入口，归档本Change。后续结构升级从此基线明确处理与测试，当前不实现迁移；远端CI、真机/跨机与发布缺口保持原范围。
