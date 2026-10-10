# 执行与验证

工作区Runweft main/8269666、HAPI codex/execution-contract/3ac8b08b均干净。用户已确认目标和退出方案；按AGENTS既有授权完成工程细节和自动验收。

## Plan评审

iclaude在当前工作区一次无工具/无持久会话评审：退出0、is_error=false、303574ms。采纳UTF-16固定向量、实际目录证据、取消运行期更新、partial-startup清理、阶段错误继续清理、父进程退出码/锁/控制端口及同候选核验。保留一次500ms通知，不增加version-mismatch补发；拒绝最终超时同步强删仍可能有操作的锁，沿既有陈旧锁恢复。补充无响应连接、独立会话存活及启动失败验收。

## T1

已从实际Claude2.1.283原生可执行文件核对算法，SHA256为1859583ce32920595c61ef868bee52e1b1594f7486db209935e01f1e5e804ae2。基线201字符cwd产生201字符目录名，Claude规则期望207字符，匹配为false。固定hash向量由独立Python UTF-16/int32计算，未从HAPI实现回填。

HAPI提交标题：hapi-session-and-shutdown T1: match Claude long project directory names。getProjectPath公共适配，增加固定原生向量、200/201、BMP/代理对、完整原始输入hash、截断碰撞和长路径IO区分。相关三文件25项通过，补入真实向量后path16项通过；CLI typecheck通过。扫描cli/hub/shared/web仅一个projects计算实现。

实际iclaude/Claude2.1.283在299字符、无symlink的专用cwd创建原生JSONL，目录前缀200字符加77odt8，与适配一致。原配置摘要核对通过，认证副本未变并已删除。完整临时证据位于.dev-smoke/hapi-session-and-shutdown/path-probe/evidence.json；脱敏事实留在本记录。未修改用户原生配置。
