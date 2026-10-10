# 执行与验证

工作区Runweft main/8269666、HAPI codex/execution-contract/3ac8b08b均干净。用户已确认目标和退出方案；按AGENTS既有授权完成工程细节和自动验收。

## Plan评审

iclaude在当前工作区一次无工具/无持久会话评审：退出0、is_error=false、303574ms。采纳UTF-16固定向量、实际目录证据、取消运行期更新、partial-startup清理、阶段错误继续清理、父进程退出码/锁/控制端口及同候选核验。保留一次500ms通知，不增加version-mismatch补发；拒绝最终超时同步强删仍可能有操作的锁，沿既有陈旧锁恢复。补充无响应连接、独立会话存活及启动失败验收。

## T1

- Commit：HAPI 46430e47；Runweft c2ec2a7。

已从实际Claude2.1.283原生可执行文件核对算法，SHA256为1859583ce32920595c61ef868bee52e1b1594f7486db209935e01f1e5e804ae2。基线201字符cwd产生201字符目录名，Claude规则期望207字符，匹配为false。固定hash向量由独立Python UTF-16/int32计算，未从HAPI实现回填。

HAPI提交标题：hapi-session-and-shutdown T1: match Claude long project directory names。getProjectPath公共适配，增加固定原生向量、200/201、BMP/代理对、完整原始输入hash、截断碰撞和长路径IO区分。相关三文件25项通过，补入真实向量后path16项通过；CLI typecheck通过。扫描cli/hub/shared/web仅一个projects计算实现。

实际iclaude/Claude2.1.283在299字符、无symlink的专用cwd创建原生JSONL，目录前缀200字符加77odt8，与适配一致。原配置摘要核对通过，认证副本未变并已删除。完整临时证据位于.dev-smoke/hapi-session-and-shutdown/path-probe/evidence.json；脱敏事实留在本记录。未修改用户原生配置。

## T2

- Commit：HAPI 8f774b94（包含T1）；Runweft ea44c9b。

退出固定清理器登记启动过程中取得的资源；同步门禁与heartbeat停止，运行期重试可取消，迟到ACK及重连不再恢复running。一次versioned通知500ms、不补发，随后同时abort三个manager，关闭控制服务，按PID清除状态及锁，局部失败仍释放后续资源。整体8秒、控制等待10秒；本地成功0，异常/清理失败/超时1；启动listen错误改为reject以进入已有清理流程。

CLI typecheck通过；全量271文件3049项通过、11项skip。首轮全量仅skills非Git测试失败：/tmp/.git为既有目录标记，纯文件扫描误把fixture祖先视为Git根；未修改它或技能实现，改用无Git祖先的/var/tmp/.dev-smoke/hapi-session-and-shutdown后全量通过。Runner串行集成14项通过、1项压力测试skip；另新增专门验证，实际Runner停后独立session PID仍活，1项通过、其余未选。所有test-owned进程的最终清理审计通过。通知失败/无ACK、更新取消/迟到ACK、停止门禁、清理失败继续、重复请求及期限日志均有回归。

## T3

- Commit：Runweft b4c99f1a651099e65aa9a7a098132add638878a7。

package.json/gitlink固定HAPI 8f774b9413fd483bc163cc06425d7646f10a7c92；CLI0.30.7、protocol1不变。删除撤权smoke接受exit1的例外，现要求0、无信号、正常清理日志、state/lock不存在及control port关闭；新凭据恢复原machineId。新增独立smoke-hapi-session-and-shutdown入口，调用真实编译Runner及专用Claude Task。

先执行build:hapi再build；旧缓存的首次build被revision核验拒绝，未用旧二进制验收。root typecheck通过；最终248项/4800断言通过，33项Node检查通过；access四脚本均退出0，包含真实撤权旧Runner退出0/清理并用新凭据启动。

同候选Runner正常121ms、Hub无ACK617ms、Hub停服112ms及新启动原machineId114ms均退出0/无信号；启动凭据失败456ms退出1。五例state/lock均清除；启动失败控制端口从本PID日志补查，五个端口均关闭。真实268字符物理cwd两轮Claude Task完成/原生停止，保持同一HAPI/native session、回忆上一轮标记，无reconstruction。复制认证摘要未变，原配置verify通过，副本和测试服务凭据已删；cleanupErrors为空。未接触原始用户配置或已有独立HAPI服务。

详细同候选hash、命令和映射见acceptance.md。原始当前现场在.dev-smoke，未提交；无需重跑已通过完整发行矩阵，本轮未做其他平台/物理远端验证。T1/T2与本轮核心/集成均为真实执行结果，算法说明、代码审阅及跨平台推断另行区分。

按用户授权完成本地自动验收，Requirement/Plan已完成；同步Specs及归档。不将未发布源码视为已发布1.1.1更新。
